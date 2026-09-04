--
-- PostgreSQL database dump
--
-- Synthetic fixture. Every name, address and value below is invented for
-- testing and refers to no real person, company or account.
--
-- Dumped from EnterpriseDB Postgres Advanced Server 16.2.0
-- Dumped by pg_dump version 16.2 (EnterpriseDB)

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET edb_redwood_date = off;
SET edb_redwood_strings = off;
SET edb_stmt_level_tx = off;
SET search_path = public;

--
-- Name: ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger (
    id integer NOT NULL,
    memo character varying(200),
    amount numeric(12,2),
    posted_at timestamp without time zone
);

COPY public.ledger (id, memo, amount, posted_at) FROM stdin;
1	Opening balance	1000.00	2024-01-01 00:00:00
2	Coffee; supplies	\N	2024-02-02 09:15:00
3	Café Zoë refund	-12.50	2024-03-03 17:45:00
\.

--
-- Name: parties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parties (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    email character varying(160)
);

INSERT INTO public.parties VALUES (1, 'Alice Example', 'alice@example.test');
INSERT INTO public.parties VALUES (2, 'Bob Example', NULL);

ALTER TABLE ONLY public.ledger
    ADD CONSTRAINT ledger_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_pkey PRIMARY KEY (id);
