-- =====================================================================
-- Sistema de alertas tempranas para inundaciones - San Pedro de Macorís
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO → Run.
-- Es seguro volver a ejecutarlo (no borra datos). Si ya habías ejecutado
-- la versión anterior, este script la actualiza (quita el INSERT público).
--
-- Este archivo NO contiene secretos: puede subirse a Git.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Puntos de monitoreo (los ocho candidatos)
create table if not exists puntos (
  id               serial primary key,
  nombre           text not null unique,
  sector           text,
  latitud          numeric(9,6),
  longitud         numeric(9,6),
  altura_sensor_cm numeric(6,1) not null default 100,  -- distancia del sensor al fondo (calibración)
  activo           boolean not null default true
);

-- Umbrales por punto (los edita el operador desde la página de configuración)
create table if not exists configuracion (
  punto_id            int primary key references puntos(id) on delete cascade,
  nivel_amarillo_cm   numeric(5,1) not null default 20,
  nivel_rojo_cm       numeric(5,1) not null default 40,
  vel_amarillo_cm_min numeric(5,1) not null default 2,   -- subida en cm por minuto
  vel_rojo_cm_min     numeric(5,1) not null default 5,
  check (nivel_rojo_cm > nivel_amarillo_cm),
  check (vel_rojo_cm_min > vel_amarillo_cm_min)
);

-- Lecturas del sensor
create table if not exists lecturas (
  id               bigserial primary key,
  punto_id         int not null references puntos(id) on delete cascade,
  distancia_cm     numeric(6,1) not null check (distancia_cm between 2 and 400),
  nivel_cm         numeric(6,1) not null,      -- altura_sensor - distancia (mínimo 0)
  velocidad_cm_min numeric(6,2) not null default 0,
  estado           text not null check (estado in ('verde','amarillo','rojo')),
  creado_en        timestamptz not null default now()
);

create index if not exists idx_lecturas_punto_fecha
  on lecturas (punto_id, creado_en desc);

-- Dispositivos autorizados a enviar lecturas. Se guarda solo el HASH del token.
create table if not exists dispositivos (
  id          serial primary key,
  punto_id    int not null references puntos(id) on delete cascade,
  token_hash  text not null unique,
  descripcion text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- Personas autorizadas a cambiar umbrales (Defensa Civil / equipo)
create table if not exists operadores (
  email text primary key
);

-- ---------------------------------------------------------------------
-- 2. DATOS INICIALES
-- ---------------------------------------------------------------------
insert into puntos (nombre, sector) values
  ('Villa Progreso II', 'Villa Progreso'),
  ('Kennedy',           'Barrio Kennedy'),
  ('Sarmiento',         'Sarmiento'),
  ('Barrio Lindo',      'Barrio Lindo'),
  ('Cantalarrana',      'Cantalarrana'),
  ('Los Guandules',     'Los Guandules'),
  ('Nuevo Renacer',     'Nuevo Renacer'),
  ('La Barca',          'La Barca')
on conflict (nombre) do nothing;

insert into configuracion (punto_id)
select id from puntos
on conflict (punto_id) do nothing;

-- ---------------------------------------------------------------------
-- 3. FUNCIONES
-- ---------------------------------------------------------------------

-- ¿El usuario que hace la petición es un operador autorizado?
create or replace function es_operador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from operadores
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Único camino para insertar lecturas. El ESP32 llama a esta función con su
-- token; el servidor valida el token, el rango, calcula nivel, velocidad y
-- estado, y guarda. Así nadie puede inventar lecturas ni estados.
create or replace function registrar_lectura(p_token text, p_distancia_cm numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_disp   dispositivos%rowtype;
  v_altura numeric;
  v_cfg    configuracion%rowtype;
  v_prev   lecturas%rowtype;
  v_nivel  numeric;
  v_vel    numeric := 0;
  v_estado text;
begin
  -- 1) Autenticar el dispositivo
  if p_token is null or length(p_token) < 16 then
    raise exception 'dispositivo no autorizado' using errcode = '42501';
  end if;

  select * into v_disp
  from dispositivos
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and activo;

  if not found then
    raise exception 'dispositivo no autorizado' using errcode = '42501';
  end if;

  -- 2) Validar la lectura
  if p_distancia_cm is null or p_distancia_cm < 2 or p_distancia_cm > 400 then
    raise exception 'lectura fuera de rango' using errcode = '22003';
  end if;

  -- 3) Límite de frecuencia (evita saturar la base de datos)
  if exists (
    select 1 from lecturas
    where punto_id = v_disp.punto_id
      and creado_en > now() - interval '5 seconds'
  ) then
    raise exception 'demasiadas lecturas' using errcode = '54000';
  end if;

  -- 4) Nivel y configuración del punto
  select altura_sensor_cm into v_altura from puntos where id = v_disp.punto_id;

  select * into v_cfg from configuracion where punto_id = v_disp.punto_id;
  if not found then
    v_cfg.nivel_amarillo_cm   := 20;
    v_cfg.nivel_rojo_cm       := 40;
    v_cfg.vel_amarillo_cm_min := 2;
    v_cfg.vel_rojo_cm_min     := 5;
  end if;

  v_nivel := greatest(0, round(v_altura - p_distancia_cm, 1));

  -- 5) Velocidad de subida: contra la lectura de hace al menos 60 s (máx. 10 min)
  select * into v_prev
  from lecturas
  where punto_id = v_disp.punto_id
    and creado_en <= now() - interval '60 seconds'
    and creado_en >= now() - interval '10 minutes'
  order by creado_en desc
  limit 1;

  if found then
    v_vel := (v_nivel - v_prev.nivel_cm)
             / (extract(epoch from (now() - v_prev.creado_en)) / 60.0);
    v_vel := round(least(greatest(v_vel, -999), 999), 2);
  end if;

  -- 6) Estado (misma regla que estado.js y el firmware)
  if v_nivel >= v_cfg.nivel_rojo_cm or v_vel >= v_cfg.vel_rojo_cm_min then
    v_estado := 'rojo';
  elsif v_nivel >= v_cfg.nivel_amarillo_cm or v_vel >= v_cfg.vel_amarillo_cm_min then
    v_estado := 'amarillo';
  else
    v_estado := 'verde';
  end if;

  insert into lecturas (punto_id, distancia_cm, nivel_cm, velocidad_cm_min, estado)
  values (v_disp.punto_id, round(p_distancia_cm, 1), v_nivel, v_vel, v_estado);

  return jsonb_build_object(
    'estado', v_estado,
    'nivel_cm', v_nivel,
    'velocidad_cm_min', v_vel
  );
end;
$$;

revoke all on function registrar_lectura(text, numeric) from public;
grant execute on function registrar_lectura(text, numeric) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. VISTA: última lectura de cada punto (para la lista del panel)
-- ---------------------------------------------------------------------
create or replace view ultima_lectura_por_punto
with (security_invoker = true) as
select distinct on (punto_id)
       punto_id, nivel_cm, velocidad_cm_min, estado, creado_en
from lecturas
order by punto_id, creado_en desc;

grant select on ultima_lectura_por_punto to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. SEGURIDAD (Row Level Security)
-- ---------------------------------------------------------------------
alter table puntos        enable row level security;
alter table configuracion enable row level security;
alter table lecturas      enable row level security;
alter table dispositivos  enable row level security;   -- sin políticas: nadie la ve por la API
alter table operadores    enable row level security;   -- sin políticas: nadie la ve por la API

-- Limpieza de políticas anteriores (incluye la versión vieja que permitía insertar a cualquiera)
drop policy if exists "leer puntos"        on puntos;
drop policy if exists "leer config"        on configuracion;
drop policy if exists "leer lecturas"      on lecturas;
drop policy if exists "insertar lecturas"  on lecturas;
drop policy if exists "editar config"      on configuracion;
drop policy if exists "editar puntos"      on puntos;

-- Lectura pública: los residentes ven el panel sin iniciar sesión
create policy "leer puntos"   on puntos        for select using (true);
create policy "leer config"   on configuracion for select using (true);
create policy "leer lecturas" on lecturas      for select using (true);

-- Escritura: solo operadores autorizados (no basta con tener una cuenta)
create policy "editar config" on configuracion
  for update to authenticated
  using (es_operador()) with check (es_operador());

create policy "editar puntos" on puntos
  for update to authenticated
  using (es_operador()) with check (es_operador());

-- Lecturas: no hay política de INSERT. Solo se insertan con registrar_lectura().

-- ---------------------------------------------------------------------
-- 6. TIEMPO REAL (el panel se actualiza solo al llegar una lectura)
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table lecturas;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- =====================================================================
-- 7. PASOS MANUALES (ejecútalos aparte, con TUS valores; no subas los
--    valores reales a Git)
-- =====================================================================
--
-- a) Operador: crea el usuario en Authentication → Users (correo y
--    contraseña) y autorízalo:
--
--      insert into operadores (email) values ('correo-del-operador@ejemplo.com');
--
--    Recomendado: en Authentication → Sign In / Providers, desactiva
--    "Allow new users to sign up" para que nadie más pueda crear cuentas.
--
-- b) Dispositivo ESP32: inventa un token largo y aleatorio (32+ caracteres),
--    guárdalo en secrets.h del firmware y registra aquí solo su hash:
--
--      insert into dispositivos (punto_id, token_hash, descripcion)
--      values (
--        (select id from puntos where nombre = 'Kennedy'),
--        encode(extensions.digest('PON-AQUI-TU-TOKEN-LARGO-Y-ALEATORIO', 'sha256'), 'hex'),
--        'ESP32 prototipo'
--      );
--
-- c) Para revocar un dispositivo perdido:
--
--      update dispositivos set activo = false where descripcion = 'ESP32 prototipo';
