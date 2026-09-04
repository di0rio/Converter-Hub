--
-- PostgreSQL database dump
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--

-- Dumped from database version 15.6 (Citus 12.1.1)
-- Dumped by pg_dump version 15.6

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);

CREATE EXTENSION IF NOT EXISTS citus WITH SCHEMA public;

SET default_tablespace = '';

--
-- Name: regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regions (
    id integer NOT NULL,
    name text NOT NULL
);

INSERT INTO public.regions (id, name) VALUES (1, 'North');
INSERT INTO public.regions (id, name) VALUES (2, 'South');

SELECT create_reference_table('public.regions');

--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id bigint NOT NULL,
    tenant_id integer NOT NULL,
    payload text
);

SELECT create_distributed_table('public.events', 'tenant_id');

COPY public.events (id, tenant_id, payload) FROM stdin;
1	1	Alice Example signed up
2	1	\N
3	2	Renée Example placed an order
\.
