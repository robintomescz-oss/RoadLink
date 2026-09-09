-- RoadLink production database scaffold
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'customer' check (role in ('customer','driver')),
  is_online boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  make text,
  model text,
  registration text,
  created_at timestamptz not null default now()
);

create table if not exists tow_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  driver_id uuid references profiles(id) on delete set null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  destination text,
  vehicle text,
  problem text,
  status text not null default 'requested'
    check (status in ('requested','accepted','en_route','arrived','loaded','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists driver_locations (
  driver_id uuid primary key references profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  updated_at timestamptz not null default now()
);

create index if not exists tow_requests_status_idx on tow_requests(status);
create index if not exists tow_requests_customer_idx on tow_requests(customer_id);
create index if not exists tow_requests_driver_idx on tow_requests(driver_id);

-- Enable realtime for the tables once the project is created in Supabase.
-- RLS policies should be added before production deployment.
