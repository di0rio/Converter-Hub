--
-- Greenplum Database dump
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--

-- Dumped from database version 6.25.3 (Greenplum Database)
-- Dumped by pg_dump version 6.25.3

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);

SET default_tablespace = '';

--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id integer NOT NULL,
    customer_name text NOT NULL,
    amount numeric(10,2) NOT NULL
) DISTRIBUTED BY (id);

COPY public.orders (id, customer_name, amount) FROM stdin;
1	Alice Example	129.50
2	Renée Example	44.00
3	Charlie Example	\N
\.

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    event text NOT NULL,
    logged_at timestamp without time zone DEFAULT now()
) DISTRIBUTED RANDOMLY;

INSERT INTO public.audit_log (id, event, logged_at) VALUES (1, 'order.created', '2024-01-15 10:30:00');
INSERT INTO public.audit_log (id, event, logged_at) VALUES (2, 'order.shipped', '2024-01-16 08:00:00');
