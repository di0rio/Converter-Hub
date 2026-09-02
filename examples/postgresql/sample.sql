--
-- PostgreSQL database dump
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--

-- Dumped from database version 16.2
-- Dumped by pg_dump version 16.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: inventory; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA inventory;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    full_name character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    notes text,
    signed_up_at timestamp without time zone DEFAULT now() NOT NULL
);

--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);

--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    "order" character varying(20) NOT NULL,
    total numeric(10,2) NOT NULL,
    placed_at timestamp without time zone NOT NULL,
    CONSTRAINT orders_total_check CHECK ((total >= (0)::numeric))
);

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    message text
);

--
-- Name: parts; Type: TABLE; Schema: inventory; Owner: -
--

CREATE TABLE inventory.parts (
    sku character varying(32) NOT NULL,
    description text NOT NULL,
    quantity integer DEFAULT 0 NOT NULL
);

--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.customers (id, full_name, email, notes, signed_up_at) FROM stdin;
1	Ada Example	ada@example.com	Prefers email over phone.	2024-01-15 09:30:00
2	Břetislav Ondráček	bretislav@example.org	Ships to Praha; note the accents.	2024-02-02 14:05:00
3	Mei Ling	mei@example.net	\N	2024-03-11 08:00:00
4	Tab\tNewline	tabby@example.com	Line one\nLine two, with a comma	2024-04-01 11:45:00
\.

--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.orders (id, customer_id, "order", total, placed_at) FROM stdin;
1	1	ORD-0001	129.99	2024-01-20 10:00:00
2	1	ORD-0002	18.50	2024-02-14 17:22:00
3	3	ORD-0003	0.00	2024-03-12 09:15:00
\.

--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_log (id, message) FROM stdin;
\.

--
-- Data for Name: parts; Type: TABLE DATA; Schema: inventory; Owner: -
--
-- This table is dumped with --inserts, so its rows arrive as statements
-- rather than as a COPY block.
--

INSERT INTO inventory.parts (sku, description, quantity) VALUES ('BLT-8', 'Bolt, 8 mm; galvanised', 240);
INSERT INTO inventory.parts (sku, description, quantity) VALUES ('WSH-8', 'Washer, 8 mm — O''Brien pattern', 1150);
INSERT INTO inventory.parts (sku, description, quantity) VALUES ('NUT-8', 'Nut, 8 mm
(two-line description)', 0);

--
-- Name: customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customers_id_seq', 4, true);

--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_email_key UNIQUE (email);

--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: inventory; Owner: -
--

ALTER TABLE ONLY inventory.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (sku);

--
-- Name: orders_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_customer_id_idx ON public.orders USING btree (customer_id);

--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

--
-- PostgreSQL database dump complete
--
