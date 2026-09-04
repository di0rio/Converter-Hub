--
-- PostgreSQL database dump
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--

-- Dumped from database version 15.6 (TimescaleDB 2.14.2)
-- Dumped by pg_dump version 15.6

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);

CREATE EXTENSION IF NOT EXISTS timescaledb WITH SCHEMA public;

SET default_tablespace = '';

--
-- Name: sensors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sensors (
    id integer NOT NULL,
    label text NOT NULL
);

INSERT INTO public.sensors (id, label) VALUES (1, 'Alice Example lab — sensor A');
INSERT INTO public.sensors (id, label) VALUES (2, 'Renée Example lab — sensor B');

--
-- Name: sensor_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sensor_readings (
    id bigint NOT NULL,
    sensor_id integer NOT NULL,
    recorded_at timestamp without time zone NOT NULL,
    value numeric(10,4) NOT NULL
);

SELECT public.create_hypertable('public.sensor_readings', 'recorded_at');

COPY public.sensor_readings (id, sensor_id, recorded_at, value) FROM stdin;
1	1	2024-01-15 10:30:00	21.5000
2	1	2024-01-15 10:31:00	\N
3	2	2024-01-15 10:30:00	19.8000
\.
