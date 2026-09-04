--
-- Amazon Redshift dump
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- Schema extracted from `SELECT ddl FROM admin.v_generate_tbl_ddl`; row data
-- generated as plain INSERT statements. Redshift itself moves table data
-- through `UNLOAD`/`COPY ... FROM 's3://...'`, which is not a local SQL dump,
-- so INSERT statements are the closest thing to a portable local export.
--

SET search_path = public;

CREATE TABLE public.orders (
    id integer NOT NULL ENCODE lzo,
    customer_name character varying(256) ENCODE lzo,
    amount numeric(10,2) ENCODE delta,
    notes character varying(1000) ENCODE zstd
)
DISTSTYLE KEY
DISTKEY(id)
SORTKEY(id);

INSERT INTO public.orders (id, customer_name, amount, notes) VALUES (1, 'Alice Example', 129.50, 'Ships to depot');
INSERT INTO public.orders (id, customer_name, amount, notes) VALUES (2, 'Renée Example', 44.00, NULL);
INSERT INTO public.orders (id, customer_name, amount, notes) VALUES (3, 'Charlie Example', 8.25, 'Gift wrap, ribbon');

CREATE TABLE public.events (
    id integer NOT NULL ENCODE raw,
    event_name character varying(100) ENCODE lzo
)
DISTSTYLE EVEN
SORTKEY(id);

INSERT INTO public.events (id, event_name) VALUES (1, 'order.created');
INSERT INTO public.events (id, event_name) VALUES (2, 'order.shipped');
