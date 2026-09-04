--
-- YugabyteDB database dump
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--

-- Dumped from database version 11.2-YB-2.20.0.0-b0
-- Dumped by ysql_dump version 11.2-YB-2.20.0.0-b0

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);

SET default_tablespace = '';

--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid NOT NULL,
    full_name text NOT NULL,
    email text,
    signed_up_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT customers_pkey PRIMARY KEY (id)
) SPLIT INTO 3 TABLETS;

COPY public.customers (id, full_name, email, signed_up_at) FROM stdin;
11111111-1111-1111-1111-111111111111	Alice Example	alice@example.test	2024-01-15 10:30:00
22222222-2222-2222-2222-222222222222	Renée Example	\N	2024-02-20 14:45:00
33333333-3333-3333-3333-333333333333	Charlie Example	charlie@example.test	2024-03-10 09:15:00
\.

--
-- Name: customers_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_email_idx ON public.customers USING lsm (email) SPLIT INTO 3 TABLETS;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    customer_id uuid NOT NULL,
    "order" text NOT NULL,
    total numeric(10,2) NOT NULL
);

INSERT INTO public.orders (id, customer_id, "order", total) VALUES (1, '11111111-1111-1111-1111-111111111111', 'Widget crate', 129.50);
INSERT INTO public.orders (id, customer_id, "order", total) VALUES (2, '33333333-3333-3333-3333-333333333333', 'Bolt assortment', 44.00);
