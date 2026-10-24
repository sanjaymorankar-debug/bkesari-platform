-- Education (Laravel) database for PostgreSQL: all 74 tables + the migrations log.
-- Generated 2026-10-09 from the 66 migrations in edu/database/migrations, run with
-- `php artisan migrate` on PostgreSQL 16 and dumped with `pg_dump --schema-only --no-owner
-- --no-privileges`. It is therefore exactly what the app's own migrations create on
-- PostgreSQL: enum() columns are varchar + CHECK constraints, booleans are boolean, json is
-- json, ids are bigint with a sequence, timestamps are timestamp(0) without time zone (UTC),
-- and users.email is citext (case-insensitive, as it was under MySQL's collation).
--
-- Needs PostgreSQL 13 or newer. The citext extension is created first; it is a standard
-- "trusted" extension, so the database owner can create it without superuser rights, and
-- managed PostgreSQL services include it.
--
-- Run ONCE on an EMPTY database, as the app's own database user, in one transaction:
--     psql "$EDU_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f 01_edu_schema.sql
-- Next: 02_edu_reference_data.sql.
--
-- pg_dump writes every name schema-qualified (public.users) and sets an empty search_path
-- while it runs; that is normal and harmless.

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
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: analytics_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_snapshots (
    id bigint NOT NULL,
    scope character varying(255) NOT NULL,
    scope_id bigint,
    metrics json NOT NULL,
    calculated_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT analytics_snapshots_scope_check CHECK (((scope)::text = ANY ((ARRAY['state'::character varying, 'national'::character varying])::text[])))
);

--
-- Name: analytics_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.analytics_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: analytics_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.analytics_snapshots_id_seq OWNED BY public.analytics_snapshots.id;

--
-- Name: anonymous_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.anonymous_identities (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    context character varying(255) NOT NULL,
    anonymous_ref character varying(40) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT anonymous_identities_context_check CHECK (((context)::text = ANY ((ARRAY['parent'::character varying, 'student'::character varying])::text[])))
);

--
-- Name: anonymous_identities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.anonymous_identities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: anonymous_identities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.anonymous_identities_id_seq OWNED BY public.anonymous_identities.id;

--
-- Name: appeals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appeals (
    id bigint NOT NULL,
    complaint_id bigint NOT NULL,
    district_id bigint NOT NULL,
    state_id bigint NOT NULL,
    anonymous_ref character varying(40) NOT NULL,
    reason text NOT NULL,
    status character varying(255) DEFAULT 'submitted'::character varying NOT NULL,
    reviewed_by_user_id bigint,
    decision_note text,
    resolved_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT appeals_status_check CHECK (((status)::text = ANY ((ARRAY['submitted'::character varying, 'under_review'::character varying, 'upheld'::character varying, 'denied'::character varying])::text[])))
);

--
-- Name: appeals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.appeals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: appeals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.appeals_id_seq OWNED BY public.appeals.id;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    user_id bigint,
    action character varying(80) NOT NULL,
    auditable_type character varying(255),
    auditable_id bigint,
    ip_address character varying(45),
    metadata json,
    created_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;

--
-- Name: benchmark_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.benchmark_references (
    id bigint NOT NULL,
    dimension character varying(60) NOT NULL,
    system_name character varying(100) NOT NULL,
    system_type character varying(255) DEFAULT 'country'::character varying NOT NULL,
    practice text NOT NULL,
    relevance text,
    source_name character varying(200) NOT NULL,
    source_url character varying(500),
    source_year smallint NOT NULL,
    source_verified boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT benchmark_references_system_type_check CHECK (((system_type)::text = ANY ((ARRAY['country'::character varying, 'framework'::character varying])::text[])))
);

--
-- Name: benchmark_references_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.benchmark_references_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: benchmark_references_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.benchmark_references_id_seq OWNED BY public.benchmark_references.id;

--
-- Name: cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache (
    key character varying(255) NOT NULL,
    value text NOT NULL,
    expiration bigint NOT NULL
);

--
-- Name: cache_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache_locks (
    key character varying(255) NOT NULL,
    owner character varying(255) NOT NULL,
    expiration bigint NOT NULL
);

--
-- Name: capability_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capability_observations (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    observer_user_id bigint NOT NULL,
    observer_role character varying(255) NOT NULL,
    domain character varying(255) NOT NULL,
    strand character varying(120) NOT NULL,
    observation_type character varying(255) NOT NULL,
    observation text NOT NULL,
    evidence_context text,
    academic_term character varying(40) NOT NULL,
    observed_on date NOT NULL,
    moderation_status character varying(255) DEFAULT 'approved'::character varying NOT NULL,
    moderated_by_user_id bigint,
    moderated_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT capability_observations_domain_check CHECK (((domain)::text = ANY ((ARRAY['cognitive_scholastic'::character varying, 'socio_emotional'::character varying, 'creative_co_scholastic'::character varying, 'physical_development'::character varying, 'life_skills'::character varying])::text[]))),
    CONSTRAINT capability_observations_moderation_status_check CHECK (((moderation_status)::text = ANY ((ARRAY['approved'::character varying, 'pending'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT capability_observations_observation_type_check CHECK (((observation_type)::text = ANY ((ARRAY['strength'::character varying, 'growth_area'::character varying])::text[]))),
    CONSTRAINT capability_observations_observer_role_check CHECK (((observer_role)::text = ANY ((ARRAY['teacher'::character varying, 'parent'::character varying, 'self'::character varying, 'peer'::character varying])::text[])))
);

--
-- Name: capability_observations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.capability_observations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: capability_observations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.capability_observations_id_seq OWNED BY public.capability_observations.id;

--
-- Name: career_interest_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.career_interest_profiles (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    captured_by_user_id bigint NOT NULL,
    academic_term character varying(40) NOT NULL,
    interest_areas json NOT NULL,
    enjoyed_activities json,
    reflection text,
    captured_on date NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: career_interest_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.career_interest_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: career_interest_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.career_interest_profiles_id_seq OWNED BY public.career_interest_profiles.id;

--
-- Name: coaching_programmes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coaching_programmes (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    academic_year character varying(9) NOT NULL,
    programme_name character varying(150) NOT NULL,
    programme_type character varying(255) DEFAULT 'other'::character varying NOT NULL,
    provider_type character varying(255) DEFAULT 'school'::character varying NOT NULL,
    provider_name character varying(150),
    applicable_classes character varying(100),
    faculty character varying(200),
    duration character varying(100),
    timing character varying(100),
    during_school_hours boolean DEFAULT false NOT NULL,
    fee numeric(12,2),
    bundled_into_school_fees boolean DEFAULT false NOT NULL,
    is_mandatory boolean DEFAULT false NOT NULL,
    certification_offered boolean DEFAULT false NOT NULL,
    recorded_by_user_id bigint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT coaching_programmes_programme_type_check CHECK (((programme_type)::text = ANY ((ARRAY['jee'::character varying, 'neet'::character varying, 'cuet'::character varying, 'clat'::character varying, 'nda'::character varying, 'olympiad'::character varying, 'scholarship'::character varying, 'coding'::character varying, 'robotics'::character varying, 'languages'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT coaching_programmes_provider_type_check CHECK (((provider_type)::text = ANY ((ARRAY['school'::character varying, 'external_partner'::character varying])::text[])))
);

--
-- Name: coaching_programmes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coaching_programmes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: coaching_programmes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coaching_programmes_id_seq OWNED BY public.coaching_programmes.id;

--
-- Name: complaint_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_categories (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    description text,
    is_child_safety boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: complaint_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.complaint_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: complaint_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.complaint_categories_id_seq OWNED BY public.complaint_categories.id;

--
-- Name: complaint_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_evidence (
    id bigint NOT NULL,
    complaint_id bigint NOT NULL,
    uploaded_by character varying(255) DEFAULT 'submitter'::character varying NOT NULL,
    original_filename character varying(255) NOT NULL,
    stored_filename character varying(255) NOT NULL,
    mime_type character varying(100) NOT NULL,
    size_bytes bigint NOT NULL,
    disk character varying(40) DEFAULT 'local'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT complaint_evidence_uploaded_by_check CHECK (((uploaded_by)::text = ANY ((ARRAY['submitter'::character varying, 'school'::character varying])::text[])))
);

--
-- Name: complaint_evidence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.complaint_evidence_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: complaint_evidence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.complaint_evidence_id_seq OWNED BY public.complaint_evidence.id;

--
-- Name: complaint_resolutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_resolutions (
    id bigint NOT NULL,
    complaint_id bigint NOT NULL,
    resolution_summary text,
    confirmed_by_submitter character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    confirmed_at timestamp(0) without time zone,
    escalated boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT complaint_resolutions_confirmed_by_submitter_check CHECK (((confirmed_by_submitter)::text = ANY ((ARRAY['pending'::character varying, 'yes'::character varying, 'partially'::character varying, 'no'::character varying])::text[])))
);

--
-- Name: complaint_resolutions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.complaint_resolutions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: complaint_resolutions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.complaint_resolutions_id_seq OWNED BY public.complaint_resolutions.id;

--
-- Name: complaint_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_responses (
    id bigint NOT NULL,
    complaint_id bigint NOT NULL,
    responder_type character varying(255) NOT NULL,
    responder_user_id bigint,
    message text NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT complaint_responses_responder_type_check CHECK (((responder_type)::text = ANY ((ARRAY['school'::character varying, 'district'::character varying, 'state'::character varying])::text[])))
);

--
-- Name: complaint_responses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.complaint_responses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: complaint_responses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.complaint_responses_id_seq OWNED BY public.complaint_responses.id;

--
-- Name: complaint_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_status_history (
    id bigint NOT NULL,
    complaint_id bigint NOT NULL,
    from_status character varying(40),
    to_status character varying(40) NOT NULL,
    changed_by_user_id bigint,
    note text,
    created_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: complaint_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.complaint_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: complaint_status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.complaint_status_history_id_seq OWNED BY public.complaint_status_history.id;

--
-- Name: complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaints (
    id bigint NOT NULL,
    complaint_number character varying(40) NOT NULL,
    school_id bigint NOT NULL,
    complaint_category_id bigint NOT NULL,
    district_id bigint NOT NULL,
    state_id bigint NOT NULL,
    anonymous_ref character varying(40) NOT NULL,
    submitted_role character varying(255) NOT NULL,
    subject character varying(255) NOT NULL,
    description text NOT NULL,
    severity character varying(255) DEFAULT 'medium'::character varying NOT NULL,
    status character varying(255) DEFAULT 'submitted'::character varying NOT NULL,
    is_child_safety_flag boolean DEFAULT false NOT NULL,
    resolved_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT complaints_severity_check CHECK (((severity)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[]))),
    CONSTRAINT complaints_status_check CHECK (((status)::text = ANY ((ARRAY['submitted'::character varying, 'under_review'::character varying, 'school_responded'::character varying, 'escalated'::character varying, 'investigating'::character varying, 'action_taken'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[]))),
    CONSTRAINT complaints_submitted_role_check CHECK (((submitted_role)::text = ANY ((ARRAY['parent'::character varying, 'student'::character varying])::text[])))
);

--
-- Name: complaints_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.complaints_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: complaints_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.complaints_id_seq OWNED BY public.complaints.id;

--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_records (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    granted_by_user_id bigint NOT NULL,
    purpose character varying(255) NOT NULL,
    notice_text text NOT NULL,
    notice_version character varying(20) NOT NULL,
    status character varying(255) DEFAULT 'granted'::character varying NOT NULL,
    verification_method character varying(60) NOT NULL,
    granted_at timestamp(0) without time zone NOT NULL,
    withdrawn_at timestamp(0) without time zone,
    expires_at timestamp(0) without time zone,
    ip_address character varying(45),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT consent_records_purpose_check CHECK (((purpose)::text = ANY ((ARRAY['capability_growth'::character varying, 'career_pathway'::character varying, 'life_skills'::character varying, 'physical_health'::character varying, 'mental_wellbeing'::character varying, 'alumni_outcomes'::character varying])::text[]))),
    CONSTRAINT consent_records_status_check CHECK (((status)::text = ANY ((ARRAY['granted'::character varying, 'withdrawn'::character varying, 'expired'::character varying])::text[])))
);

--
-- Name: consent_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.consent_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: consent_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.consent_records_id_seq OWNED BY public.consent_records.id;

--
-- Name: counselling_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.counselling_sessions (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    wellbeing_concern_id bigint,
    session_date date NOT NULL,
    session_type character varying(255) DEFAULT 'follow_up'::character varying NOT NULL,
    session_notes text NOT NULL,
    shareable_summary text,
    support_plan text,
    interventions text,
    referred_externally boolean DEFAULT false NOT NULL,
    referral_detail character varying(255),
    next_session_date date,
    counsellor_user_id bigint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT counselling_sessions_session_type_check CHECK (((session_type)::text = ANY ((ARRAY['initial'::character varying, 'follow_up'::character varying, 'group'::character varying, 'parent_meeting'::character varying, 'crisis'::character varying, 'other'::character varying])::text[])))
);

--
-- Name: counselling_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.counselling_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: counselling_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.counselling_sessions_id_seq OWNED BY public.counselling_sessions.id;

--
-- Name: course_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_ratings (
    id bigint NOT NULL,
    course_id bigint NOT NULL,
    school_id bigint NOT NULL,
    academic_year character varying(9) NOT NULL,
    anonymous_ref character varying(40) NOT NULL,
    rater_role character varying(255) NOT NULL,
    curriculum_relevance smallint,
    course_quality smallint,
    conceptual_learning smallint,
    practical_learning smallint,
    project_work smallint,
    learning_resources smallint,
    teaching_quality smallint,
    course_organisation smallint,
    engagement smallint,
    career_relevance smallint,
    comment text,
    submitted_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT course_ratings_rater_role_check CHECK (((rater_role)::text = ANY ((ARRAY['parent'::character varying, 'student'::character varying])::text[])))
);

--
-- Name: course_ratings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.course_ratings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: course_ratings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.course_ratings_id_seq OWNED BY public.course_ratings.id;

--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    academic_year character varying(9) NOT NULL,
    name character varying(150) NOT NULL,
    course_type character varying(255) DEFAULT 'core_subject'::character varying NOT NULL,
    applicable_classes character varying(100),
    stream character varying(60),
    description text,
    recorded_by_user_id bigint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT courses_course_type_check CHECK (((course_type)::text = ANY ((ARRAY['core_subject'::character varying, 'elective'::character varying, 'stream'::character varying, 'vocational'::character varying, 'language'::character varying, 'programme'::character varying, 'other'::character varying])::text[])))
);

--
-- Name: courses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.courses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: courses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.courses_id_seq OWNED BY public.courses.id;

--
-- Name: data_subject_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_subject_requests (
    id bigint NOT NULL,
    reference character varying(20) NOT NULL,
    requester_user_id bigint NOT NULL,
    subject_user_id bigint NOT NULL,
    request_type character varying(255) NOT NULL,
    categories json NOT NULL,
    detail text,
    status character varying(255) DEFAULT 'submitted'::character varying NOT NULL,
    outcome_by_category json,
    response_note text,
    handled_by_user_id bigint,
    handled_at timestamp(0) without time zone,
    due_by timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT data_subject_requests_request_type_check CHECK (((request_type)::text = ANY ((ARRAY['access'::character varying, 'correction'::character varying, 'erasure'::character varying])::text[]))),
    CONSTRAINT data_subject_requests_status_check CHECK (((status)::text = ANY ((ARRAY['submitted'::character varying, 'under_review'::character varying, 'completed'::character varying, 'partially_completed'::character varying, 'refused'::character varying])::text[])))
);

--
-- Name: data_subject_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.data_subject_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: data_subject_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.data_subject_requests_id_seq OWNED BY public.data_subject_requests.id;

--
-- Name: districts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.districts (
    id bigint NOT NULL,
    state_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(20) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: districts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.districts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: districts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.districts_id_seq OWNED BY public.districts.id;

--
-- Name: external_exams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_exams (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    academic_year character varying(9) NOT NULL,
    exam_name character varying(150) NOT NULL,
    conducting_body character varying(150),
    exam_type character varying(255) DEFAULT 'other'::character varying NOT NULL,
    applicable_classes character varying(100),
    eligibility text,
    registration_process text,
    through_school boolean DEFAULT true NOT NULL,
    exam_fee numeric(12,2),
    preparation_offered boolean DEFAULT false NOT NULL,
    preparation_fee numeric(12,2),
    is_mandatory boolean DEFAULT false NOT NULL,
    frequency character varying(255) DEFAULT 'annual'::character varying NOT NULL,
    recorded_by_user_id bigint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT external_exams_exam_type_check CHECK (((exam_type)::text = ANY ((ARRAY['olympiad'::character varying, 'scholarship'::character varying, 'competitive'::character varying, 'entrance'::character varying, 'international'::character varying, 'language'::character varying, 'skill_certification'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT external_exams_frequency_check CHECK (((frequency)::text = ANY ((ARRAY['annual'::character varying, 'biannual'::character varying, 'termly'::character varying, 'one_off'::character varying])::text[])))
);

--
-- Name: external_exams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.external_exams_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: external_exams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.external_exams_id_seq OWNED BY public.external_exams.id;

--
-- Name: facility_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_claims (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    facility_key character varying(60) NOT NULL,
    academic_year character varying(9) NOT NULL,
    is_offered boolean DEFAULT true NOT NULL,
    description text,
    applicable_classes character varying(100),
    availability character varying(255) DEFAULT 'all_students'::character varying NOT NULL,
    capacity integer,
    fee_amount numeric(12,2),
    is_mandatory boolean DEFAULT false NOT NULL,
    provider character varying(150),
    evidence_path character varying(255),
    evidence_note text,
    verification_status character varying(255) DEFAULT 'unverified'::character varying NOT NULL,
    verified_by_user_id bigint,
    verified_at timestamp(0) without time zone,
    recorded_by_user_id bigint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT facility_claims_availability_check CHECK (((availability)::text = ANY ((ARRAY['all_students'::character varying, 'selected_classes'::character varying, 'optional_enrolment'::character varying, 'limited'::character varying])::text[]))),
    CONSTRAINT facility_claims_verification_status_check CHECK (((verification_status)::text = ANY ((ARRAY['unverified'::character varying, 'pending'::character varying, 'verified'::character varying])::text[])))
);

--
-- Name: facility_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.facility_claims_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: facility_claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.facility_claims_id_seq OWNED BY public.facility_claims.id;

--
-- Name: facility_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_ratings (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    facility_key character varying(60) NOT NULL,
    academic_year character varying(9) NOT NULL,
    anonymous_ref character varying(40) NOT NULL,
    rater_role character varying(255) NOT NULL,
    availability_report character varying(255) NOT NULL,
    quality smallint,
    equipment smallint,
    usage_frequency smallint,
    staff_support smallint,
    overall_usefulness smallint,
    comment text,
    submitted_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT facility_ratings_availability_report_check CHECK (((availability_report)::text = ANY ((ARRAY['available'::character varying, 'partially_available'::character varying, 'not_available'::character varying])::text[]))),
    CONSTRAINT facility_ratings_rater_role_check CHECK (((rater_role)::text = ANY ((ARRAY['parent'::character varying, 'student'::character varying])::text[])))
);

--
-- Name: facility_ratings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.facility_ratings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: facility_ratings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.facility_ratings_id_seq OWNED BY public.facility_ratings.id;

--
-- Name: failed_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.failed_jobs (
    id bigint NOT NULL,
    uuid character varying(255) NOT NULL,
    connection character varying(255) NOT NULL,
    queue character varying(255) NOT NULL,
    payload text NOT NULL,
    exception text NOT NULL,
    failed_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: failed_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.failed_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: failed_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.failed_jobs_id_seq OWNED BY public.failed_jobs.id;

--
-- Name: fee_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_revisions (
    id bigint NOT NULL,
    fee_id bigint NOT NULL,
    school_id bigint NOT NULL,
    changed_by_user_id bigint NOT NULL,
    previous_amount numeric(12,2) NOT NULL,
    new_amount numeric(12,2) NOT NULL,
    previous_snapshot json NOT NULL,
    reason text,
    changed_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: fee_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fee_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: fee_revisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fee_revisions_id_seq OWNED BY public.fee_revisions.id;

--
-- Name: fees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fees (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    academic_year character varying(9) NOT NULL,
    class_grade character varying(20),
    stream character varying(60),
    category character varying(255) NOT NULL,
    label character varying(150) NOT NULL,
    amount numeric(12,2) NOT NULL,
    frequency character varying(255) NOT NULL,
    is_mandatory boolean DEFAULT true NOT NULL,
    is_refundable boolean DEFAULT false NOT NULL,
    conditions text,
    effective_from date NOT NULL,
    state_cap_status character varying(255) DEFAULT 'not_applicable'::character varying NOT NULL,
    recorded_by_user_id bigint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT fees_category_check CHECK (((category)::text = ANY ((ARRAY['admission'::character varying, 'registration'::character varying, 'tuition'::character varying, 'annual'::character varying, 'development'::character varying, 'term'::character varying, 'examination'::character varying, 'assessment'::character varying, 'laboratory'::character varying, 'computer'::character varying, 'library'::character varying, 'sports'::character varying, 'activity'::character varying, 'transport'::character varying, 'hostel'::character varying, 'meals'::character varying, 'books'::character varying, 'uniform'::character varying, 'id_card'::character varying, 'diary'::character varying, 'field_trips'::character varying, 'competitions'::character varying, 'external_exam'::character varying, 'certification'::character varying, 'coaching'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT fees_frequency_check CHECK (((frequency)::text = ANY ((ARRAY['one_time'::character varying, 'monthly'::character varying, 'quarterly'::character varying, 'term'::character varying, 'annual'::character varying])::text[]))),
    CONSTRAINT fees_state_cap_status_check CHECK (((state_cap_status)::text = ANY ((ARRAY['not_applicable'::character varying, 'within_cap'::character varying, 'pending_review'::character varying, 'exceeds_cap'::character varying])::text[])))
);

--
-- Name: fees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: fees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fees_id_seq OWNED BY public.fees.id;

--
-- Name: fraud_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_flags (
    id bigint NOT NULL,
    flag_type character varying(255) NOT NULL,
    subject_type character varying(255) NOT NULL,
    subject_id bigint NOT NULL,
    details json,
    status character varying(255) DEFAULT 'open'::character varying NOT NULL,
    reviewed_by_user_id bigint,
    reviewed_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT fraud_flags_flag_type_check CHECK (((flag_type)::text = ANY ((ARRAY['feedback_spike'::character varying, 'coordinated_review'::character varying, 'duplicate_pattern'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT fraud_flags_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'reviewing'::character varying, 'dismissed'::character varying, 'confirmed'::character varying])::text[]))),
    CONSTRAINT fraud_flags_subject_type_check CHECK (((subject_type)::text = ANY ((ARRAY['school'::character varying, 'teacher'::character varying])::text[])))
);

--
-- Name: fraud_flags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fraud_flags_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: fraud_flags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fraud_flags_id_seq OWNED BY public.fraud_flags.id;

--
-- Name: growth_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_goals (
    id bigint NOT NULL,
    growth_plan_id bigint NOT NULL,
    domain character varying(255) NOT NULL,
    goal_statement text NOT NULL,
    support_at_school text NOT NULL,
    support_at_home text NOT NULL,
    student_voice text,
    status character varying(255) DEFAULT 'set'::character varying NOT NULL,
    review_note text,
    reviewed_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT growth_goals_domain_check CHECK (((domain)::text = ANY ((ARRAY['cognitive_scholastic'::character varying, 'socio_emotional'::character varying, 'creative_co_scholastic'::character varying, 'physical_development'::character varying, 'life_skills'::character varying])::text[]))),
    CONSTRAINT growth_goals_status_check CHECK (((status)::text = ANY ((ARRAY['set'::character varying, 'in_progress'::character varying, 'achieved'::character varying, 'continuing'::character varying])::text[])))
);

--
-- Name: growth_goals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.growth_goals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_goals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.growth_goals_id_seq OWNED BY public.growth_goals.id;

--
-- Name: growth_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_plans (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    created_by_user_id bigint NOT NULL,
    academic_term character varying(40) NOT NULL,
    status character varying(255) DEFAULT 'draft'::character varying NOT NULL,
    summary_for_parent text,
    shared_with_parent_at timestamp(0) without time zone,
    parent_acknowledged_at timestamp(0) without time zone,
    reviewed_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT growth_plans_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'completed'::character varying, 'archived'::character varying])::text[])))
);

--
-- Name: growth_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.growth_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: growth_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.growth_plans_id_seq OWNED BY public.growth_plans.id;

--
-- Name: health_access_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_access_logs (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    actor_user_id bigint NOT NULL,
    actor_role character varying(60),
    record_type character varying(255) NOT NULL,
    record_id bigint,
    action character varying(255) NOT NULL,
    detail character varying(255),
    occurred_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT health_access_logs_action_check CHECK (((action)::text = ANY ((ARRAY['viewed'::character varying, 'created'::character varying, 'updated'::character varying, 'downloaded'::character varying, 'denied'::character varying])::text[]))),
    CONSTRAINT health_access_logs_record_type_check CHECK (((record_type)::text = ANY ((ARRAY['physical_health'::character varying, 'wellbeing_concern'::character varying, 'counselling_session'::character varying, 'followup'::character varying])::text[])))
);

--
-- Name: health_access_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.health_access_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: health_access_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.health_access_logs_id_seq OWNED BY public.health_access_logs.id;

--
-- Name: health_followups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_followups (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    physical_health_record_id bigint,
    area character varying(255) DEFAULT 'general'::character varying NOT NULL,
    finding text NOT NULL,
    recommended_action text,
    status character varying(255) DEFAULT 'identified'::character varying NOT NULL,
    identified_on date NOT NULL,
    due_on date,
    completed_on date,
    outcome text,
    opened_by_user_id bigint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT health_followups_area_check CHECK (((area)::text = ANY ((ARRAY['vision'::character varying, 'hearing'::character varying, 'dental'::character varying, 'nutrition'::character varying, 'general'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT health_followups_status_check CHECK (((status)::text = ANY ((ARRAY['identified'::character varying, 'referred'::character varying, 'follow_up'::character varying, 'completed'::character varying, 'closed'::character varying])::text[])))
);

--
-- Name: health_followups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.health_followups_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: health_followups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.health_followups_id_seq OWNED BY public.health_followups.id;

--
-- Name: identity_access_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_access_logs (
    id bigint NOT NULL,
    officer_user_id bigint NOT NULL,
    anonymous_ref character varying(40) NOT NULL,
    action character varying(80) NOT NULL,
    reason text,
    created_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: identity_access_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.identity_access_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: identity_access_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.identity_access_logs_id_seq OWNED BY public.identity_access_logs.id;

--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    invited_by_user_id bigint NOT NULL,
    email character varying(255) NOT NULL,
    role character varying(255) NOT NULL,
    student_name character varying(255),
    token character varying(64) NOT NULL,
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    accepted_by_user_id bigint,
    accepted_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT invitations_role_check CHECK (((role)::text = ANY ((ARRAY['parent'::character varying, 'student'::character varying, 'teacher'::character varying])::text[]))),
    CONSTRAINT invitations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'revoked'::character varying])::text[])))
);

--
-- Name: invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invitations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invitations_id_seq OWNED BY public.invitations.id;

--
-- Name: job_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_batches (
    id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    total_jobs integer NOT NULL,
    pending_jobs integer NOT NULL,
    failed_jobs integer NOT NULL,
    failed_job_ids text NOT NULL,
    options text,
    cancelled_at integer,
    created_at integer NOT NULL,
    finished_at integer
);

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id bigint NOT NULL,
    queue character varying(255) NOT NULL,
    payload text NOT NULL,
    attempts smallint NOT NULL,
    reserved_at integer,
    available_at integer NOT NULL,
    created_at integer NOT NULL
);

--
-- Name: jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jobs_id_seq OWNED BY public.jobs.id;

--
-- Name: life_skills_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.life_skills_tracking (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    recorded_by_user_id bigint NOT NULL,
    skill_area character varying(255) NOT NULL,
    activity_title character varying(200) NOT NULL,
    activity_description text,
    participation_level character varying(255) NOT NULL,
    academic_term character varying(40) NOT NULL,
    recorded_on date NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT life_skills_tracking_participation_level_check CHECK (((participation_level)::text = ANY ((ARRAY['participated'::character varying, 'engaged'::character varying, 'led'::character varying])::text[]))),
    CONSTRAINT life_skills_tracking_skill_area_check CHECK (((skill_area)::text = ANY ((ARRAY['financial_literacy'::character varying, 'digital_literacy_safety'::character varying, 'civic_citizenship'::character varying, 'communication'::character varying, 'leadership'::character varying, 'critical_thinking'::character varying, 'emotional_intelligence'::character varying, 'environmental_awareness'::character varying])::text[])))
);

--
-- Name: life_skills_tracking_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.life_skills_tracking_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: life_skills_tracking_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.life_skills_tracking_id_seq OWNED BY public.life_skills_tracking.id;

--
-- Name: migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    migration character varying(255) NOT NULL,
    batch integer NOT NULL
);

--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;

--
-- Name: model_has_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_has_permissions (
    permission_id bigint NOT NULL,
    model_type character varying(255) NOT NULL,
    model_id bigint NOT NULL
);

--
-- Name: model_has_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_has_roles (
    role_id bigint NOT NULL,
    model_type character varying(255) NOT NULL,
    model_id bigint NOT NULL
);

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid NOT NULL,
    type character varying(255) NOT NULL,
    notifiable_type character varying(255) NOT NULL,
    notifiable_id bigint NOT NULL,
    data text NOT NULL,
    read_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: officer_jurisdictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.officer_jurisdictions (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    level character varying(255) NOT NULL,
    district_id bigint,
    state_id bigint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT officer_jurisdictions_level_check CHECK (((level)::text = ANY ((ARRAY['district'::character varying, 'state'::character varying, 'national'::character varying])::text[])))
);

--
-- Name: officer_jurisdictions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.officer_jurisdictions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: officer_jurisdictions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.officer_jurisdictions_id_seq OWNED BY public.officer_jurisdictions.id;

--
-- Name: parent_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parent_profiles (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    phone character varying(20),
    verified_at timestamp(0) without time zone,
    verification_method character varying(40),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: parent_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parent_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: parent_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parent_profiles_id_seq OWNED BY public.parent_profiles.id;

--
-- Name: parent_school_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parent_school_relationships (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    student_user_id bigint,
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    verified_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT parent_school_relationships_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'verified'::character varying, 'rejected'::character varying])::text[])))
);

--
-- Name: parent_school_relationships_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parent_school_relationships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: parent_school_relationships_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parent_school_relationships_id_seq OWNED BY public.parent_school_relationships.id;

--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    email character varying(255) NOT NULL,
    token character varying(255) NOT NULL,
    created_at timestamp(0) without time zone
);

--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    guard_name character varying(255) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permissions_id_seq OWNED BY public.permissions.id;

--
-- Name: physical_health_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.physical_health_records (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    academic_year character varying(9) NOT NULL,
    examination_date date NOT NULL,
    examination_type character varying(255) DEFAULT 'annual_screening'::character varying NOT NULL,
    height_cm numeric(5,1),
    weight_kg numeric(5,1),
    bmi numeric(4,1),
    vision_left character varying(20),
    vision_right character varying(20),
    hearing character varying(255),
    dental character varying(255),
    general_examination text,
    nutrition_observations text,
    health_concerns text,
    recommendations text,
    next_due_date date,
    recorded_by_user_id bigint NOT NULL,
    recorded_by_designation character varying(100),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT physical_health_records_dental_check CHECK (((dental)::text = ANY ((ARRAY['normal'::character varying, 'concern_noted'::character varying, 'not_tested'::character varying])::text[]))),
    CONSTRAINT physical_health_records_examination_type_check CHECK (((examination_type)::text = ANY ((ARRAY['annual_screening'::character varying, 'follow_up'::character varying, 'incident'::character varying, 'immunisation'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT physical_health_records_hearing_check CHECK (((hearing)::text = ANY ((ARRAY['normal'::character varying, 'concern_noted'::character varying, 'not_tested'::character varying])::text[])))
);

--
-- Name: physical_health_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.physical_health_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: physical_health_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.physical_health_records_id_seq OWNED BY public.physical_health_records.id;

--
-- Name: retaliation_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retaliation_reports (
    id bigint NOT NULL,
    complaint_id bigint,
    school_id bigint NOT NULL,
    district_id bigint NOT NULL,
    state_id bigint NOT NULL,
    anonymous_ref character varying(40) NOT NULL,
    submitted_role character varying(255) NOT NULL,
    category character varying(255) NOT NULL,
    description text NOT NULL,
    status character varying(255) DEFAULT 'submitted'::character varying NOT NULL,
    resolved_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT retaliation_reports_category_check CHECK (((category)::text = ANY ((ARRAY['intimidation'::character varying, 'harassment'::character varying, 'discrimination'::character varying, 'punishment'::character varying, 'academic_retaliation'::character varying, 'threats'::character varying, 'withdrawal_of_facilities'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT retaliation_reports_status_check CHECK (((status)::text = ANY ((ARRAY['submitted'::character varying, 'under_review'::character varying, 'investigating'::character varying, 'action_taken'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[]))),
    CONSTRAINT retaliation_reports_submitted_role_check CHECK (((submitted_role)::text = ANY ((ARRAY['parent'::character varying, 'student'::character varying])::text[])))
);

--
-- Name: retaliation_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.retaliation_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: retaliation_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.retaliation_reports_id_seq OWNED BY public.retaliation_reports.id;

--
-- Name: role_has_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_has_permissions (
    permission_id bigint NOT NULL,
    role_id bigint NOT NULL
);

--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    guard_name character varying(255) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;

--
-- Name: safeguarding_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safeguarding_events (
    id bigint NOT NULL,
    safeguarding_report_id bigint NOT NULL,
    event_type character varying(255) NOT NULL,
    actor_user_id bigint,
    actor_role character varying(60),
    detail text,
    occurred_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT safeguarding_events_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['submitted'::character varying, 'legal_duty_shown'::character varying, 'acknowledged'::character varying, 'assigned'::character varying, 'external_report_recorded'::character varying, 'investigation_started'::character varying, 'note_added'::character varying, 'closed'::character varying, 'reopened'::character varying, 'viewed'::character varying])::text[])))
);

--
-- Name: safeguarding_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.safeguarding_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: safeguarding_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.safeguarding_events_id_seq OWNED BY public.safeguarding_events.id;

--
-- Name: safeguarding_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safeguarding_reports (
    id bigint NOT NULL,
    reference character varying(20) NOT NULL,
    school_id bigint NOT NULL,
    district_id bigint NOT NULL,
    state_id bigint NOT NULL,
    anonymous_ref character varying(40) NOT NULL,
    reporter_role character varying(255) NOT NULL,
    category character varying(255) NOT NULL,
    description text NOT NULL,
    immediate_danger boolean DEFAULT false NOT NULL,
    status character varying(255) DEFAULT 'submitted'::character varying NOT NULL,
    legal_duty_shown_at timestamp(0) without time zone,
    external_report_acknowledged_at timestamp(0) without time zone,
    external_report_acknowledged_by bigint,
    external_report_channel character varying(255),
    external_report_reference character varying(100),
    assigned_officer_user_id bigint,
    acknowledged_at timestamp(0) without time zone,
    closed_at timestamp(0) without time zone,
    closed_by_user_id bigint,
    closure_reason text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT safeguarding_reports_category_check CHECK (((category)::text = ANY ((ARRAY['child_sexual_abuse'::character varying, 'physical_abuse'::character varying, 'emotional_abuse'::character varying, 'neglect'::character varying, 'serious_violence'::character varying, 'immediate_danger'::character varying, 'serious_harassment'::character varying, 'criminal_allegation'::character varying, 'other_serious_concern'::character varying])::text[]))),
    CONSTRAINT safeguarding_reports_external_report_channel_check CHECK (((external_report_channel)::text = ANY ((ARRAY['police'::character varying, 'sjpu'::character varying, 'childline_1098'::character varying, 'cwc'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT safeguarding_reports_reporter_role_check CHECK (((reporter_role)::text = ANY ((ARRAY['parent'::character varying, 'student'::character varying, 'teacher'::character varying, 'staff'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT safeguarding_reports_status_check CHECK (((status)::text = ANY ((ARRAY['submitted'::character varying, 'acknowledged'::character varying, 'external_report_confirmed'::character varying, 'under_investigation'::character varying, 'closed'::character varying])::text[])))
);

--
-- Name: safeguarding_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.safeguarding_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: safeguarding_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.safeguarding_reports_id_seq OWNED BY public.safeguarding_reports.id;

--
-- Name: school_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_feedback (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    anonymous_ref character varying(40) NOT NULL,
    rater_role character varying(255) NOT NULL,
    dimension_scores json NOT NULL,
    overall_comment text,
    submitted_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT school_feedback_rater_role_check CHECK (((rater_role)::text = ANY ((ARRAY['parent'::character varying, 'student'::character varying])::text[])))
);

--
-- Name: school_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.school_feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: school_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.school_feedback_id_seq OWNED BY public.school_feedback.id;

--
-- Name: school_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_profiles (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    about text,
    facilities json,
    sports json,
    fees json,
    policies text,
    has_transport boolean DEFAULT false NOT NULL,
    has_hostel boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: school_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.school_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: school_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.school_profiles_id_seq OWNED BY public.school_profiles.id;

--
-- Name: school_quality_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_quality_scores (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    score numeric(5,2) NOT NULL,
    confidence character varying(255) NOT NULL,
    response_count integer NOT NULL,
    component_breakdown json NOT NULL,
    calculated_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT school_quality_scores_confidence_check CHECK (((confidence)::text = ANY ((ARRAY['high'::character varying, 'medium'::character varying, 'low'::character varying, 'insufficient_data'::character varying])::text[])))
);

--
-- Name: school_quality_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.school_quality_scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: school_quality_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.school_quality_scores_id_seq OWNED BY public.school_quality_scores.id;

--
-- Name: school_rating_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_rating_components (
    id bigint NOT NULL,
    key character varying(60) NOT NULL,
    label character varying(255) NOT NULL,
    weight numeric(5,2) DEFAULT '10'::numeric NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: school_rating_components_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.school_rating_components_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: school_rating_components_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.school_rating_components_id_seq OWNED BY public.school_rating_components.id;

--
-- Name: school_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_replies (
    id bigint NOT NULL,
    school_id bigint NOT NULL,
    context_type character varying(255) NOT NULL,
    context_key character varying(60),
    academic_year character varying(9) NOT NULL,
    body text NOT NULL,
    author_user_id bigint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT school_replies_context_type_check CHECK (((context_type)::text = ANY ((ARRAY['facility_discrepancy'::character varying, 'course_feedback'::character varying, 'general_feedback'::character varying])::text[])))
);

--
-- Name: school_replies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.school_replies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: school_replies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.school_replies_id_seq OWNED BY public.school_replies.id;

--
-- Name: school_staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_staff (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    designation character varying(60) DEFAULT 'School Admin'::character varying NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: school_staff_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.school_staff_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: school_staff_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.school_staff_id_seq OWNED BY public.school_staff.id;

--
-- Name: schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schools (
    id bigint NOT NULL,
    school_code character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    board character varying(255) DEFAULT 'STATE'::character varying NOT NULL,
    management_type character varying(255) DEFAULT 'private'::character varying NOT NULL,
    state_id bigint NOT NULL,
    district_id bigint NOT NULL,
    address character varying(255) NOT NULL,
    city character varying(255) NOT NULL,
    pincode character varying(10) NOT NULL,
    phone character varying(255),
    email character varying(255),
    website character varying(255),
    recognition_status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    classes_from character varying(20),
    classes_to character varying(20),
    student_count integer DEFAULT 0 NOT NULL,
    teacher_count integer DEFAULT 0 NOT NULL,
    established_year smallint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    udise_code character varying(20),
    udise_verified_at timestamp(0) without time zone,
    udise_verified_by_user_id bigint,
    CONSTRAINT schools_board_check CHECK (((board)::text = ANY ((ARRAY['CBSE'::character varying, 'ICSE'::character varying, 'STATE'::character varying, 'IB'::character varying, 'OTHER'::character varying])::text[]))),
    CONSTRAINT schools_management_type_check CHECK (((management_type)::text = ANY ((ARRAY['government'::character varying, 'aided'::character varying, 'private'::character varying, 'international'::character varying])::text[]))),
    CONSTRAINT schools_recognition_status_check CHECK (((recognition_status)::text = ANY ((ARRAY['verified'::character varying, 'pending'::character varying, 'under_review'::character varying])::text[])))
);

--
-- Name: schools_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schools_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: schools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schools_id_seq OWNED BY public.schools.id;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id character varying(255) NOT NULL,
    user_id bigint,
    ip_address character varying(45),
    user_agent text,
    payload text NOT NULL,
    last_activity integer NOT NULL
);

--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id bigint NOT NULL,
    key character varying(100) NOT NULL,
    value text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;

--
-- Name: states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.states (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(10) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: states_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.states_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.states_id_seq OWNED BY public.states.id;

--
-- Name: student_academic_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_academic_records (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    subject character varying(100) NOT NULL,
    term character varying(40) NOT NULL,
    score numeric(6,2) NOT NULL,
    max_score numeric(6,2) DEFAULT '100'::numeric NOT NULL,
    recorded_by_user_id bigint NOT NULL,
    recorded_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: student_academic_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_academic_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: student_academic_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_academic_records_id_seq OWNED BY public.student_academic_records.id;

--
-- Name: student_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_profiles (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    date_of_birth date,
    gender character varying(20),
    verified_at timestamp(0) without time zone,
    verification_method character varying(40),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: student_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: student_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_profiles_id_seq OWNED BY public.student_profiles.id;

--
-- Name: student_school_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_school_relationships (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    class_grade character varying(20),
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    verified_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT student_school_relationships_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'verified'::character varying, 'rejected'::character varying])::text[])))
);

--
-- Name: student_school_relationships_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_school_relationships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: student_school_relationships_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_school_relationships_id_seq OWNED BY public.student_school_relationships.id;

--
-- Name: teacher_effectiveness_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_effectiveness_scores (
    id bigint NOT NULL,
    teacher_user_id bigint NOT NULL,
    score numeric(5,2) NOT NULL,
    confidence character varying(255) NOT NULL,
    response_count integer NOT NULL,
    component_breakdown json NOT NULL,
    calculated_at timestamp(0) without time zone NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT teacher_effectiveness_scores_confidence_check CHECK (((confidence)::text = ANY ((ARRAY['high'::character varying, 'medium'::character varying, 'low'::character varying, 'insufficient_data'::character varying])::text[])))
);

--
-- Name: teacher_effectiveness_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teacher_effectiveness_scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: teacher_effectiveness_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teacher_effectiveness_scores_id_seq OWNED BY public.teacher_effectiveness_scores.id;

--
-- Name: teacher_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_feedback (
    id bigint NOT NULL,
    teacher_user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    anonymous_ref character varying(40) NOT NULL,
    rater_role character varying(255) NOT NULL,
    dimension_scores json NOT NULL,
    overall_comment text,
    submitted_at timestamp(0) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT teacher_feedback_rater_role_check CHECK (((rater_role)::text = ANY ((ARRAY['parent'::character varying, 'student'::character varying])::text[])))
);

--
-- Name: teacher_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teacher_feedback_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: teacher_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teacher_feedback_id_seq OWNED BY public.teacher_feedback.id;

--
-- Name: teacher_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_profiles (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    subject_specialization character varying(255),
    qualification character varying(255),
    joining_date date,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: teacher_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teacher_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: teacher_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teacher_profiles_id_seq OWNED BY public.teacher_profiles.id;

--
-- Name: teacher_rating_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_rating_components (
    id bigint NOT NULL,
    key character varying(60) NOT NULL,
    label character varying(255) NOT NULL,
    weight numeric(5,2) DEFAULT '10'::numeric NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: teacher_rating_components_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teacher_rating_components_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: teacher_rating_components_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teacher_rating_components_id_seq OWNED BY public.teacher_rating_components.id;

--
-- Name: teacher_school_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_school_relationships (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    verified_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT teacher_school_relationships_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'verified'::character varying, 'rejected'::character varying])::text[])))
);

--
-- Name: teacher_school_relationships_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teacher_school_relationships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: teacher_school_relationships_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teacher_school_relationships_id_seq OWNED BY public.teacher_school_relationships.id;

--
-- Name: two_factor_authentications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.two_factor_authentications (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    secret text NOT NULL,
    recovery_codes text,
    confirmed_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: two_factor_authentications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.two_factor_authentications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: two_factor_authentications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.two_factor_authentications_id_seq OWNED BY public.two_factor_authentications.id;

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    name character varying(255) NOT NULL,
    email public.citext NOT NULL,
    email_verified_at timestamp(0) without time zone,
    password character varying(255) NOT NULL,
    remember_token character varying(100),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone
);

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

--
-- Name: wellbeing_concerns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wellbeing_concerns (
    id bigint NOT NULL,
    student_user_id bigint NOT NULL,
    school_id bigint NOT NULL,
    observation text NOT NULL,
    context character varying(200),
    observed_on date NOT NULL,
    raised_by_user_id bigint NOT NULL,
    raised_by_role character varying(60) NOT NULL,
    referral_status character varying(255) DEFAULT 'raised'::character varying NOT NULL,
    seen_at timestamp(0) without time zone,
    seen_by_user_id bigint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT wellbeing_concerns_referral_status_check CHECK (((referral_status)::text = ANY ((ARRAY['raised'::character varying, 'seen_by_counsellor'::character varying, 'closed_without_referral'::character varying])::text[])))
);

--
-- Name: wellbeing_concerns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wellbeing_concerns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: wellbeing_concerns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wellbeing_concerns_id_seq OWNED BY public.wellbeing_concerns.id;

--
-- Name: analytics_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_snapshots ALTER COLUMN id SET DEFAULT nextval('public.analytics_snapshots_id_seq'::regclass);

--
-- Name: anonymous_identities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_identities ALTER COLUMN id SET DEFAULT nextval('public.anonymous_identities_id_seq'::regclass);

--
-- Name: appeals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appeals ALTER COLUMN id SET DEFAULT nextval('public.appeals_id_seq'::regclass);

--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);

--
-- Name: benchmark_references id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmark_references ALTER COLUMN id SET DEFAULT nextval('public.benchmark_references_id_seq'::regclass);

--
-- Name: capability_observations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_observations ALTER COLUMN id SET DEFAULT nextval('public.capability_observations_id_seq'::regclass);

--
-- Name: career_interest_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.career_interest_profiles ALTER COLUMN id SET DEFAULT nextval('public.career_interest_profiles_id_seq'::regclass);

--
-- Name: coaching_programmes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_programmes ALTER COLUMN id SET DEFAULT nextval('public.coaching_programmes_id_seq'::regclass);

--
-- Name: complaint_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_categories ALTER COLUMN id SET DEFAULT nextval('public.complaint_categories_id_seq'::regclass);

--
-- Name: complaint_evidence id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_evidence ALTER COLUMN id SET DEFAULT nextval('public.complaint_evidence_id_seq'::regclass);

--
-- Name: complaint_resolutions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_resolutions ALTER COLUMN id SET DEFAULT nextval('public.complaint_resolutions_id_seq'::regclass);

--
-- Name: complaint_responses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_responses ALTER COLUMN id SET DEFAULT nextval('public.complaint_responses_id_seq'::regclass);

--
-- Name: complaint_status_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_status_history ALTER COLUMN id SET DEFAULT nextval('public.complaint_status_history_id_seq'::regclass);

--
-- Name: complaints id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints ALTER COLUMN id SET DEFAULT nextval('public.complaints_id_seq'::regclass);

--
-- Name: consent_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records ALTER COLUMN id SET DEFAULT nextval('public.consent_records_id_seq'::regclass);

--
-- Name: counselling_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counselling_sessions ALTER COLUMN id SET DEFAULT nextval('public.counselling_sessions_id_seq'::regclass);

--
-- Name: course_ratings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_ratings ALTER COLUMN id SET DEFAULT nextval('public.course_ratings_id_seq'::regclass);

--
-- Name: courses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses ALTER COLUMN id SET DEFAULT nextval('public.courses_id_seq'::regclass);

--
-- Name: data_subject_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_subject_requests ALTER COLUMN id SET DEFAULT nextval('public.data_subject_requests_id_seq'::regclass);

--
-- Name: districts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts ALTER COLUMN id SET DEFAULT nextval('public.districts_id_seq'::regclass);

--
-- Name: external_exams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_exams ALTER COLUMN id SET DEFAULT nextval('public.external_exams_id_seq'::regclass);

--
-- Name: facility_claims id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_claims ALTER COLUMN id SET DEFAULT nextval('public.facility_claims_id_seq'::regclass);

--
-- Name: facility_ratings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_ratings ALTER COLUMN id SET DEFAULT nextval('public.facility_ratings_id_seq'::regclass);

--
-- Name: failed_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_jobs ALTER COLUMN id SET DEFAULT nextval('public.failed_jobs_id_seq'::regclass);

--
-- Name: fee_revisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_revisions ALTER COLUMN id SET DEFAULT nextval('public.fee_revisions_id_seq'::regclass);

--
-- Name: fees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fees ALTER COLUMN id SET DEFAULT nextval('public.fees_id_seq'::regclass);

--
-- Name: fraud_flags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_flags ALTER COLUMN id SET DEFAULT nextval('public.fraud_flags_id_seq'::regclass);

--
-- Name: growth_goals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_goals ALTER COLUMN id SET DEFAULT nextval('public.growth_goals_id_seq'::regclass);

--
-- Name: growth_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_plans ALTER COLUMN id SET DEFAULT nextval('public.growth_plans_id_seq'::regclass);

--
-- Name: health_access_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_access_logs ALTER COLUMN id SET DEFAULT nextval('public.health_access_logs_id_seq'::regclass);

--
-- Name: health_followups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_followups ALTER COLUMN id SET DEFAULT nextval('public.health_followups_id_seq'::regclass);

--
-- Name: identity_access_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_access_logs ALTER COLUMN id SET DEFAULT nextval('public.identity_access_logs_id_seq'::regclass);

--
-- Name: invitations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations ALTER COLUMN id SET DEFAULT nextval('public.invitations_id_seq'::regclass);

--
-- Name: jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs ALTER COLUMN id SET DEFAULT nextval('public.jobs_id_seq'::regclass);

--
-- Name: life_skills_tracking id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.life_skills_tracking ALTER COLUMN id SET DEFAULT nextval('public.life_skills_tracking_id_seq'::regclass);

--
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);

--
-- Name: officer_jurisdictions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.officer_jurisdictions ALTER COLUMN id SET DEFAULT nextval('public.officer_jurisdictions_id_seq'::regclass);

--
-- Name: parent_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_profiles ALTER COLUMN id SET DEFAULT nextval('public.parent_profiles_id_seq'::regclass);

--
-- Name: parent_school_relationships id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_school_relationships ALTER COLUMN id SET DEFAULT nextval('public.parent_school_relationships_id_seq'::regclass);

--
-- Name: permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions ALTER COLUMN id SET DEFAULT nextval('public.permissions_id_seq'::regclass);

--
-- Name: physical_health_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_health_records ALTER COLUMN id SET DEFAULT nextval('public.physical_health_records_id_seq'::regclass);

--
-- Name: retaliation_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retaliation_reports ALTER COLUMN id SET DEFAULT nextval('public.retaliation_reports_id_seq'::regclass);

--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);

--
-- Name: safeguarding_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_events ALTER COLUMN id SET DEFAULT nextval('public.safeguarding_events_id_seq'::regclass);

--
-- Name: safeguarding_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_reports ALTER COLUMN id SET DEFAULT nextval('public.safeguarding_reports_id_seq'::regclass);

--
-- Name: school_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_feedback ALTER COLUMN id SET DEFAULT nextval('public.school_feedback_id_seq'::regclass);

--
-- Name: school_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_profiles ALTER COLUMN id SET DEFAULT nextval('public.school_profiles_id_seq'::regclass);

--
-- Name: school_quality_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_quality_scores ALTER COLUMN id SET DEFAULT nextval('public.school_quality_scores_id_seq'::regclass);

--
-- Name: school_rating_components id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_rating_components ALTER COLUMN id SET DEFAULT nextval('public.school_rating_components_id_seq'::regclass);

--
-- Name: school_replies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_replies ALTER COLUMN id SET DEFAULT nextval('public.school_replies_id_seq'::regclass);

--
-- Name: school_staff id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_staff ALTER COLUMN id SET DEFAULT nextval('public.school_staff_id_seq'::regclass);

--
-- Name: schools id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools ALTER COLUMN id SET DEFAULT nextval('public.schools_id_seq'::regclass);

--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);

--
-- Name: states id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.states ALTER COLUMN id SET DEFAULT nextval('public.states_id_seq'::regclass);

--
-- Name: student_academic_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_academic_records ALTER COLUMN id SET DEFAULT nextval('public.student_academic_records_id_seq'::regclass);

--
-- Name: student_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles ALTER COLUMN id SET DEFAULT nextval('public.student_profiles_id_seq'::regclass);

--
-- Name: student_school_relationships id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_school_relationships ALTER COLUMN id SET DEFAULT nextval('public.student_school_relationships_id_seq'::regclass);

--
-- Name: teacher_effectiveness_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_effectiveness_scores ALTER COLUMN id SET DEFAULT nextval('public.teacher_effectiveness_scores_id_seq'::regclass);

--
-- Name: teacher_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_feedback ALTER COLUMN id SET DEFAULT nextval('public.teacher_feedback_id_seq'::regclass);

--
-- Name: teacher_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_profiles ALTER COLUMN id SET DEFAULT nextval('public.teacher_profiles_id_seq'::regclass);

--
-- Name: teacher_rating_components id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_rating_components ALTER COLUMN id SET DEFAULT nextval('public.teacher_rating_components_id_seq'::regclass);

--
-- Name: teacher_school_relationships id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_school_relationships ALTER COLUMN id SET DEFAULT nextval('public.teacher_school_relationships_id_seq'::regclass);

--
-- Name: two_factor_authentications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.two_factor_authentications ALTER COLUMN id SET DEFAULT nextval('public.two_factor_authentications_id_seq'::regclass);

--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

--
-- Name: wellbeing_concerns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellbeing_concerns ALTER COLUMN id SET DEFAULT nextval('public.wellbeing_concerns_id_seq'::regclass);

--
-- Name: analytics_snapshots analytics_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_snapshots
    ADD CONSTRAINT analytics_snapshots_pkey PRIMARY KEY (id);

--
-- Name: anonymous_identities anon_identity_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_identities
    ADD CONSTRAINT anon_identity_unique UNIQUE (user_id, school_id, context);

--
-- Name: anonymous_identities anonymous_identities_anonymous_ref_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_identities
    ADD CONSTRAINT anonymous_identities_anonymous_ref_unique UNIQUE (anonymous_ref);

--
-- Name: anonymous_identities anonymous_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_identities
    ADD CONSTRAINT anonymous_identities_pkey PRIMARY KEY (id);

--
-- Name: appeals appeals_complaint_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_complaint_id_unique UNIQUE (complaint_id);

--
-- Name: appeals appeals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_pkey PRIMARY KEY (id);

--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

--
-- Name: benchmark_references benchmark_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.benchmark_references
    ADD CONSTRAINT benchmark_references_pkey PRIMARY KEY (id);

--
-- Name: cache_locks cache_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache_locks
    ADD CONSTRAINT cache_locks_pkey PRIMARY KEY (key);

--
-- Name: cache cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache
    ADD CONSTRAINT cache_pkey PRIMARY KEY (key);

--
-- Name: capability_observations capability_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_observations
    ADD CONSTRAINT capability_observations_pkey PRIMARY KEY (id);

--
-- Name: career_interest_profiles career_interest_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.career_interest_profiles
    ADD CONSTRAINT career_interest_profiles_pkey PRIMARY KEY (id);

--
-- Name: coaching_programmes coaching_programmes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_programmes
    ADD CONSTRAINT coaching_programmes_pkey PRIMARY KEY (id);

--
-- Name: complaint_categories complaint_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_categories
    ADD CONSTRAINT complaint_categories_pkey PRIMARY KEY (id);

--
-- Name: complaint_categories complaint_categories_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_categories
    ADD CONSTRAINT complaint_categories_slug_unique UNIQUE (slug);

--
-- Name: complaint_evidence complaint_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_evidence
    ADD CONSTRAINT complaint_evidence_pkey PRIMARY KEY (id);

--
-- Name: complaint_resolutions complaint_resolutions_complaint_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_resolutions
    ADD CONSTRAINT complaint_resolutions_complaint_id_unique UNIQUE (complaint_id);

--
-- Name: complaint_resolutions complaint_resolutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_resolutions
    ADD CONSTRAINT complaint_resolutions_pkey PRIMARY KEY (id);

--
-- Name: complaint_responses complaint_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_responses
    ADD CONSTRAINT complaint_responses_pkey PRIMARY KEY (id);

--
-- Name: complaint_status_history complaint_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_status_history
    ADD CONSTRAINT complaint_status_history_pkey PRIMARY KEY (id);

--
-- Name: complaints complaints_complaint_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_complaint_number_unique UNIQUE (complaint_number);

--
-- Name: complaints complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_pkey PRIMARY KEY (id);

--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);

--
-- Name: counselling_sessions counselling_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counselling_sessions
    ADD CONSTRAINT counselling_sessions_pkey PRIMARY KEY (id);

--
-- Name: course_ratings course_rating_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_ratings
    ADD CONSTRAINT course_rating_unique UNIQUE (course_id, academic_year, anonymous_ref);

--
-- Name: course_ratings course_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_ratings
    ADD CONSTRAINT course_ratings_pkey PRIMARY KEY (id);

--
-- Name: courses course_unique_per_year; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT course_unique_per_year UNIQUE (school_id, academic_year, name);

--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);

--
-- Name: data_subject_requests data_subject_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_subject_requests
    ADD CONSTRAINT data_subject_requests_pkey PRIMARY KEY (id);

--
-- Name: data_subject_requests data_subject_requests_reference_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_subject_requests
    ADD CONSTRAINT data_subject_requests_reference_unique UNIQUE (reference);

--
-- Name: districts districts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT districts_pkey PRIMARY KEY (id);

--
-- Name: districts districts_state_id_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT districts_state_id_name_unique UNIQUE (state_id, name);

--
-- Name: external_exams external_exams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_exams
    ADD CONSTRAINT external_exams_pkey PRIMARY KEY (id);

--
-- Name: facility_claims facility_claim_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_claims
    ADD CONSTRAINT facility_claim_unique UNIQUE (school_id, facility_key, academic_year);

--
-- Name: facility_claims facility_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_claims
    ADD CONSTRAINT facility_claims_pkey PRIMARY KEY (id);

--
-- Name: facility_ratings facility_rating_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_ratings
    ADD CONSTRAINT facility_rating_unique UNIQUE (school_id, facility_key, academic_year, anonymous_ref);

--
-- Name: facility_ratings facility_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_ratings
    ADD CONSTRAINT facility_ratings_pkey PRIMARY KEY (id);

--
-- Name: failed_jobs failed_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_jobs
    ADD CONSTRAINT failed_jobs_pkey PRIMARY KEY (id);

--
-- Name: failed_jobs failed_jobs_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_jobs
    ADD CONSTRAINT failed_jobs_uuid_unique UNIQUE (uuid);

--
-- Name: fee_revisions fee_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_revisions
    ADD CONSTRAINT fee_revisions_pkey PRIMARY KEY (id);

--
-- Name: fees fees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fees
    ADD CONSTRAINT fees_pkey PRIMARY KEY (id);

--
-- Name: fraud_flags fraud_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_flags
    ADD CONSTRAINT fraud_flags_pkey PRIMARY KEY (id);

--
-- Name: growth_goals growth_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_goals
    ADD CONSTRAINT growth_goals_pkey PRIMARY KEY (id);

--
-- Name: growth_plans growth_plan_student_term_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_plans
    ADD CONSTRAINT growth_plan_student_term_unique UNIQUE (student_user_id, school_id, academic_term);

--
-- Name: growth_plans growth_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_plans
    ADD CONSTRAINT growth_plans_pkey PRIMARY KEY (id);

--
-- Name: health_access_logs health_access_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_access_logs
    ADD CONSTRAINT health_access_logs_pkey PRIMARY KEY (id);

--
-- Name: health_followups health_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_followups
    ADD CONSTRAINT health_followups_pkey PRIMARY KEY (id);

--
-- Name: identity_access_logs identity_access_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_access_logs
    ADD CONSTRAINT identity_access_logs_pkey PRIMARY KEY (id);

--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);

--
-- Name: invitations invitations_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_unique UNIQUE (token);

--
-- Name: job_batches job_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_batches
    ADD CONSTRAINT job_batches_pkey PRIMARY KEY (id);

--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);

--
-- Name: life_skills_tracking life_skills_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.life_skills_tracking
    ADD CONSTRAINT life_skills_tracking_pkey PRIMARY KEY (id);

--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);

--
-- Name: model_has_permissions model_has_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_has_permissions
    ADD CONSTRAINT model_has_permissions_pkey PRIMARY KEY (permission_id, model_id, model_type);

--
-- Name: model_has_roles model_has_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_has_roles
    ADD CONSTRAINT model_has_roles_pkey PRIMARY KEY (role_id, model_id, model_type);

--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

--
-- Name: officer_jurisdictions officer_jurisdiction_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.officer_jurisdictions
    ADD CONSTRAINT officer_jurisdiction_unique UNIQUE (user_id, level, district_id, state_id);

--
-- Name: officer_jurisdictions officer_jurisdictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.officer_jurisdictions
    ADD CONSTRAINT officer_jurisdictions_pkey PRIMARY KEY (id);

--
-- Name: parent_profiles parent_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_profiles
    ADD CONSTRAINT parent_profiles_pkey PRIMARY KEY (id);

--
-- Name: parent_profiles parent_profiles_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_profiles
    ADD CONSTRAINT parent_profiles_user_id_unique UNIQUE (user_id);

--
-- Name: parent_school_relationships parent_school_rel_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_school_relationships
    ADD CONSTRAINT parent_school_rel_unique UNIQUE (user_id, school_id, student_user_id);

--
-- Name: parent_school_relationships parent_school_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_school_relationships
    ADD CONSTRAINT parent_school_relationships_pkey PRIMARY KEY (id);

--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (email);

--
-- Name: permissions permissions_name_guard_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_name_guard_name_unique UNIQUE (name, guard_name);

--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);

--
-- Name: physical_health_records physical_health_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_health_records
    ADD CONSTRAINT physical_health_records_pkey PRIMARY KEY (id);

--
-- Name: retaliation_reports retaliation_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retaliation_reports
    ADD CONSTRAINT retaliation_reports_pkey PRIMARY KEY (id);

--
-- Name: role_has_permissions role_has_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_has_permissions
    ADD CONSTRAINT role_has_permissions_pkey PRIMARY KEY (permission_id, role_id);

--
-- Name: roles roles_name_guard_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_guard_name_unique UNIQUE (name, guard_name);

--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);

--
-- Name: safeguarding_events safeguarding_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_events
    ADD CONSTRAINT safeguarding_events_pkey PRIMARY KEY (id);

--
-- Name: safeguarding_reports safeguarding_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_reports
    ADD CONSTRAINT safeguarding_reports_pkey PRIMARY KEY (id);

--
-- Name: safeguarding_reports safeguarding_reports_reference_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_reports
    ADD CONSTRAINT safeguarding_reports_reference_unique UNIQUE (reference);

--
-- Name: school_feedback school_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_feedback
    ADD CONSTRAINT school_feedback_pkey PRIMARY KEY (id);

--
-- Name: school_profiles school_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_profiles
    ADD CONSTRAINT school_profiles_pkey PRIMARY KEY (id);

--
-- Name: school_profiles school_profiles_school_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_profiles
    ADD CONSTRAINT school_profiles_school_id_unique UNIQUE (school_id);

--
-- Name: school_quality_scores school_quality_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_quality_scores
    ADD CONSTRAINT school_quality_scores_pkey PRIMARY KEY (id);

--
-- Name: school_rating_components school_rating_components_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_rating_components
    ADD CONSTRAINT school_rating_components_key_unique UNIQUE (key);

--
-- Name: school_rating_components school_rating_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_rating_components
    ADD CONSTRAINT school_rating_components_pkey PRIMARY KEY (id);

--
-- Name: school_replies school_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_replies
    ADD CONSTRAINT school_replies_pkey PRIMARY KEY (id);

--
-- Name: school_staff school_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_staff
    ADD CONSTRAINT school_staff_pkey PRIMARY KEY (id);

--
-- Name: school_staff school_staff_user_id_school_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_staff
    ADD CONSTRAINT school_staff_user_id_school_id_unique UNIQUE (user_id, school_id);

--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);

--
-- Name: schools schools_school_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_school_code_unique UNIQUE (school_code);

--
-- Name: schools schools_udise_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_udise_code_unique UNIQUE (udise_code);

--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

--
-- Name: settings settings_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_key_unique UNIQUE (key);

--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);

--
-- Name: states states_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT states_code_unique UNIQUE (code);

--
-- Name: states states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT states_pkey PRIMARY KEY (id);

--
-- Name: student_academic_records student_academic_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_academic_records
    ADD CONSTRAINT student_academic_records_pkey PRIMARY KEY (id);

--
-- Name: student_profiles student_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_pkey PRIMARY KEY (id);

--
-- Name: student_profiles student_profiles_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_user_id_unique UNIQUE (user_id);

--
-- Name: student_school_relationships student_school_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_school_relationships
    ADD CONSTRAINT student_school_relationships_pkey PRIMARY KEY (id);

--
-- Name: student_school_relationships student_school_relationships_user_id_school_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_school_relationships
    ADD CONSTRAINT student_school_relationships_user_id_school_id_unique UNIQUE (user_id, school_id);

--
-- Name: teacher_effectiveness_scores teacher_effectiveness_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_effectiveness_scores
    ADD CONSTRAINT teacher_effectiveness_scores_pkey PRIMARY KEY (id);

--
-- Name: teacher_feedback teacher_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_feedback
    ADD CONSTRAINT teacher_feedback_pkey PRIMARY KEY (id);

--
-- Name: teacher_profiles teacher_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_profiles
    ADD CONSTRAINT teacher_profiles_pkey PRIMARY KEY (id);

--
-- Name: teacher_profiles teacher_profiles_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_profiles
    ADD CONSTRAINT teacher_profiles_user_id_unique UNIQUE (user_id);

--
-- Name: teacher_rating_components teacher_rating_components_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_rating_components
    ADD CONSTRAINT teacher_rating_components_key_unique UNIQUE (key);

--
-- Name: teacher_rating_components teacher_rating_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_rating_components
    ADD CONSTRAINT teacher_rating_components_pkey PRIMARY KEY (id);

--
-- Name: teacher_school_relationships teacher_school_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_school_relationships
    ADD CONSTRAINT teacher_school_relationships_pkey PRIMARY KEY (id);

--
-- Name: teacher_school_relationships teacher_school_relationships_user_id_school_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_school_relationships
    ADD CONSTRAINT teacher_school_relationships_user_id_school_id_unique UNIQUE (user_id, school_id);

--
-- Name: two_factor_authentications two_factor_authentications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.two_factor_authentications
    ADD CONSTRAINT two_factor_authentications_pkey PRIMARY KEY (id);

--
-- Name: two_factor_authentications two_factor_authentications_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.two_factor_authentications
    ADD CONSTRAINT two_factor_authentications_user_id_unique UNIQUE (user_id);

--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: wellbeing_concerns wellbeing_concerns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellbeing_concerns
    ADD CONSTRAINT wellbeing_concerns_pkey PRIMARY KEY (id);

--
-- Name: analytics_snapshots_scope_scope_id_calculated_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_snapshots_scope_scope_id_calculated_at_index ON public.analytics_snapshots USING btree (scope, scope_id, calculated_at);

--
-- Name: appeals_state_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appeals_state_id_status_index ON public.appeals USING btree (state_id, status);

--
-- Name: appeals_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX appeals_status_index ON public.appeals USING btree (status);

--
-- Name: audit_logs_action_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_action_index ON public.audit_logs USING btree (action);

--
-- Name: audit_logs_auditable_type_auditable_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_auditable_type_auditable_id_index ON public.audit_logs USING btree (auditable_type, auditable_id);

--
-- Name: benchmark_references_dimension_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX benchmark_references_dimension_index ON public.benchmark_references USING btree (dimension);

--
-- Name: benchmark_references_system_name_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX benchmark_references_system_name_index ON public.benchmark_references USING btree (system_name);

--
-- Name: cache_expiration_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cache_expiration_index ON public.cache USING btree (expiration);

--
-- Name: cache_locks_expiration_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cache_locks_expiration_index ON public.cache_locks USING btree (expiration);

--
-- Name: cap_obs_school_term_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cap_obs_school_term_idx ON public.capability_observations USING btree (school_id, academic_term);

--
-- Name: cap_obs_student_domain_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cap_obs_student_domain_date_idx ON public.capability_observations USING btree (student_user_id, domain, observed_on);

--
-- Name: capability_observations_observer_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capability_observations_observer_user_id_index ON public.capability_observations USING btree (observer_user_id);

--
-- Name: career_profile_student_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX career_profile_student_date_idx ON public.career_interest_profiles USING btree (student_user_id, captured_on);

--
-- Name: coaching_school_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coaching_school_year_idx ON public.coaching_programmes USING btree (school_id, academic_year);

--
-- Name: complaints_anonymous_ref_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX complaints_anonymous_ref_index ON public.complaints USING btree (anonymous_ref);

--
-- Name: complaints_district_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX complaints_district_id_status_index ON public.complaints USING btree (district_id, status);

--
-- Name: complaints_school_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX complaints_school_id_status_index ON public.complaints USING btree (school_id, status);

--
-- Name: complaints_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX complaints_status_index ON public.complaints USING btree (status);

--
-- Name: consent_records_granted_by_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_records_granted_by_user_id_index ON public.consent_records USING btree (granted_by_user_id);

--
-- Name: consent_student_purpose_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_student_purpose_status_idx ON public.consent_records USING btree (student_user_id, purpose, status);

--
-- Name: counselling_counsellor_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX counselling_counsellor_date_idx ON public.counselling_sessions USING btree (counsellor_user_id, session_date);

--
-- Name: counselling_student_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX counselling_student_date_idx ON public.counselling_sessions USING btree (student_user_id, session_date);

--
-- Name: course_ratings_school_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_ratings_school_year_idx ON public.course_ratings USING btree (school_id, academic_year);

--
-- Name: courses_school_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX courses_school_year_idx ON public.courses USING btree (school_id, academic_year);

--
-- Name: data_subject_requests_due_by_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_subject_requests_due_by_index ON public.data_subject_requests USING btree (due_by);

--
-- Name: data_subject_requests_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_subject_requests_status_index ON public.data_subject_requests USING btree (status);

--
-- Name: dsr_subject_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dsr_subject_created_idx ON public.data_subject_requests USING btree (subject_user_id, created_at);

--
-- Name: external_exams_school_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_exams_school_year_idx ON public.external_exams USING btree (school_id, academic_year);

--
-- Name: facility_claims_school_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_claims_school_year_idx ON public.facility_claims USING btree (school_id, academic_year);

--
-- Name: facility_ratings_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_ratings_lookup_idx ON public.facility_ratings USING btree (school_id, facility_key, academic_year);

--
-- Name: failed_jobs_connection_queue_failed_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX failed_jobs_connection_queue_failed_at_index ON public.failed_jobs USING btree (connection, queue, failed_at);

--
-- Name: fee_revisions_fee_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fee_revisions_fee_id_index ON public.fee_revisions USING btree (fee_id);

--
-- Name: fee_revisions_school_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fee_revisions_school_date_idx ON public.fee_revisions USING btree (school_id, changed_at);

--
-- Name: fees_school_year_class_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fees_school_year_class_idx ON public.fees USING btree (school_id, academic_year, class_grade);

--
-- Name: fees_school_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fees_school_year_idx ON public.fees USING btree (school_id, academic_year);

--
-- Name: followups_school_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX followups_school_status_idx ON public.health_followups USING btree (school_id, status);

--
-- Name: followups_student_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX followups_student_status_idx ON public.health_followups USING btree (student_user_id, status);

--
-- Name: fraud_flags_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fraud_flags_status_index ON public.fraud_flags USING btree (status);

--
-- Name: fraud_flags_subject_type_subject_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fraud_flags_subject_type_subject_id_index ON public.fraud_flags USING btree (subject_type, subject_id);

--
-- Name: growth_goals_growth_plan_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_goals_growth_plan_id_index ON public.growth_goals USING btree (growth_plan_id);

--
-- Name: growth_plan_school_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_plan_school_status_idx ON public.growth_plans USING btree (school_id, status);

--
-- Name: health_access_logs_action_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX health_access_logs_action_index ON public.health_access_logs USING btree (action);

--
-- Name: health_followups_due_on_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX health_followups_due_on_index ON public.health_followups USING btree (due_on);

--
-- Name: health_logs_actor_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX health_logs_actor_time_idx ON public.health_access_logs USING btree (actor_user_id, occurred_at);

--
-- Name: health_logs_student_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX health_logs_student_time_idx ON public.health_access_logs USING btree (student_user_id, occurred_at);

--
-- Name: health_school_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX health_school_year_idx ON public.physical_health_records USING btree (school_id, academic_year);

--
-- Name: health_student_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX health_student_date_idx ON public.physical_health_records USING btree (student_user_id, examination_date);

--
-- Name: identity_access_logs_anonymous_ref_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_access_logs_anonymous_ref_index ON public.identity_access_logs USING btree (anonymous_ref);

--
-- Name: identity_access_logs_officer_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_access_logs_officer_user_id_index ON public.identity_access_logs USING btree (officer_user_id);

--
-- Name: invitations_school_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_school_id_status_index ON public.invitations USING btree (school_id, status);

--
-- Name: jobs_queue_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jobs_queue_index ON public.jobs USING btree (queue);

--
-- Name: life_skills_school_term_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX life_skills_school_term_idx ON public.life_skills_tracking USING btree (school_id, academic_term);

--
-- Name: life_skills_student_area_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX life_skills_student_area_idx ON public.life_skills_tracking USING btree (student_user_id, skill_area);

--
-- Name: model_has_permissions_model_id_model_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_has_permissions_model_id_model_type_index ON public.model_has_permissions USING btree (model_id, model_type);

--
-- Name: model_has_roles_model_id_model_type_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_has_roles_model_id_model_type_index ON public.model_has_roles USING btree (model_id, model_type);

--
-- Name: notifications_notifiable_type_notifiable_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_notifiable_type_notifiable_id_index ON public.notifications USING btree (notifiable_type, notifiable_id);

--
-- Name: retaliation_reports_anonymous_ref_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retaliation_reports_anonymous_ref_index ON public.retaliation_reports USING btree (anonymous_ref);

--
-- Name: retaliation_reports_district_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retaliation_reports_district_id_status_index ON public.retaliation_reports USING btree (district_id, status);

--
-- Name: retaliation_reports_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX retaliation_reports_status_index ON public.retaliation_reports USING btree (status);

--
-- Name: safeguarding_events_case_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safeguarding_events_case_time_idx ON public.safeguarding_events USING btree (safeguarding_report_id, occurred_at);

--
-- Name: safeguarding_reports_anonymous_ref_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safeguarding_reports_anonymous_ref_index ON public.safeguarding_reports USING btree (anonymous_ref);

--
-- Name: safeguarding_reports_district_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safeguarding_reports_district_id_status_index ON public.safeguarding_reports USING btree (district_id, status);

--
-- Name: safeguarding_reports_school_id_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safeguarding_reports_school_id_status_index ON public.safeguarding_reports USING btree (school_id, status);

--
-- Name: safeguarding_reports_status_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safeguarding_reports_status_index ON public.safeguarding_reports USING btree (status);

--
-- Name: school_feedback_anonymous_ref_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_feedback_anonymous_ref_index ON public.school_feedback USING btree (anonymous_ref);

--
-- Name: school_feedback_school_id_submitted_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_feedback_school_id_submitted_at_index ON public.school_feedback USING btree (school_id, submitted_at);

--
-- Name: school_quality_scores_school_id_calculated_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_quality_scores_school_id_calculated_at_index ON public.school_quality_scores USING btree (school_id, calculated_at);

--
-- Name: school_replies_context_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_replies_context_idx ON public.school_replies USING btree (school_id, context_type, context_key);

--
-- Name: school_replies_school_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX school_replies_school_year_idx ON public.school_replies USING btree (school_id, academic_year);

--
-- Name: schools_board_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schools_board_index ON public.schools USING btree (board);

--
-- Name: schools_name_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schools_name_index ON public.schools USING btree (name);

--
-- Name: schools_pincode_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schools_pincode_index ON public.schools USING btree (pincode);

--
-- Name: schools_state_id_district_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schools_state_id_district_id_index ON public.schools USING btree (state_id, district_id);

--
-- Name: sessions_last_activity_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_last_activity_index ON public.sessions USING btree (last_activity);

--
-- Name: sessions_user_id_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_index ON public.sessions USING btree (user_id);

--
-- Name: student_academic_records_school_id_subject_term_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX student_academic_records_school_id_subject_term_index ON public.student_academic_records USING btree (school_id, subject, term);

--
-- Name: student_academic_records_student_user_id_subject_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX student_academic_records_student_user_id_subject_index ON public.student_academic_records USING btree (student_user_id, subject);

--
-- Name: teacher_effectiveness_scores_teacher_user_id_calculated_at_inde; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_effectiveness_scores_teacher_user_id_calculated_at_inde ON public.teacher_effectiveness_scores USING btree (teacher_user_id, calculated_at);

--
-- Name: teacher_feedback_anonymous_ref_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_feedback_anonymous_ref_index ON public.teacher_feedback USING btree (anonymous_ref);

--
-- Name: teacher_feedback_teacher_user_id_submitted_at_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_feedback_teacher_user_id_submitted_at_index ON public.teacher_feedback USING btree (teacher_user_id, submitted_at);

--
-- Name: wellbeing_school_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wellbeing_school_status_idx ON public.wellbeing_concerns USING btree (school_id, referral_status);

--
-- Name: wellbeing_student_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wellbeing_student_date_idx ON public.wellbeing_concerns USING btree (student_user_id, observed_on);

--
-- Name: anonymous_identities anonymous_identities_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_identities
    ADD CONSTRAINT anonymous_identities_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: anonymous_identities anonymous_identities_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.anonymous_identities
    ADD CONSTRAINT anonymous_identities_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: appeals appeals_complaint_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_complaint_id_foreign FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;

--
-- Name: appeals appeals_district_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_district_id_foreign FOREIGN KEY (district_id) REFERENCES public.districts(id) ON DELETE RESTRICT;

--
-- Name: appeals appeals_reviewed_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_reviewed_by_user_id_foreign FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: appeals appeals_state_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appeals
    ADD CONSTRAINT appeals_state_id_foreign FOREIGN KEY (state_id) REFERENCES public.states(id) ON DELETE RESTRICT;

--
-- Name: audit_logs audit_logs_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: capability_observations capability_observations_moderated_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_observations
    ADD CONSTRAINT capability_observations_moderated_by_user_id_foreign FOREIGN KEY (moderated_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: capability_observations capability_observations_observer_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_observations
    ADD CONSTRAINT capability_observations_observer_user_id_foreign FOREIGN KEY (observer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: capability_observations capability_observations_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_observations
    ADD CONSTRAINT capability_observations_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: capability_observations capability_observations_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_observations
    ADD CONSTRAINT capability_observations_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: career_interest_profiles career_interest_profiles_captured_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.career_interest_profiles
    ADD CONSTRAINT career_interest_profiles_captured_by_user_id_foreign FOREIGN KEY (captured_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: career_interest_profiles career_interest_profiles_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.career_interest_profiles
    ADD CONSTRAINT career_interest_profiles_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: coaching_programmes coaching_programmes_recorded_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_programmes
    ADD CONSTRAINT coaching_programmes_recorded_by_user_id_foreign FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: coaching_programmes coaching_programmes_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_programmes
    ADD CONSTRAINT coaching_programmes_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: complaint_evidence complaint_evidence_complaint_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_evidence
    ADD CONSTRAINT complaint_evidence_complaint_id_foreign FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;

--
-- Name: complaint_resolutions complaint_resolutions_complaint_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_resolutions
    ADD CONSTRAINT complaint_resolutions_complaint_id_foreign FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;

--
-- Name: complaint_responses complaint_responses_complaint_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_responses
    ADD CONSTRAINT complaint_responses_complaint_id_foreign FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;

--
-- Name: complaint_responses complaint_responses_responder_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_responses
    ADD CONSTRAINT complaint_responses_responder_user_id_foreign FOREIGN KEY (responder_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: complaint_status_history complaint_status_history_changed_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_status_history
    ADD CONSTRAINT complaint_status_history_changed_by_user_id_foreign FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: complaint_status_history complaint_status_history_complaint_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_status_history
    ADD CONSTRAINT complaint_status_history_complaint_id_foreign FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE CASCADE;

--
-- Name: complaints complaints_complaint_category_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_complaint_category_id_foreign FOREIGN KEY (complaint_category_id) REFERENCES public.complaint_categories(id) ON DELETE RESTRICT;

--
-- Name: complaints complaints_district_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_district_id_foreign FOREIGN KEY (district_id) REFERENCES public.districts(id) ON DELETE RESTRICT;

--
-- Name: complaints complaints_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;

--
-- Name: complaints complaints_state_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_state_id_foreign FOREIGN KEY (state_id) REFERENCES public.states(id) ON DELETE RESTRICT;

--
-- Name: consent_records consent_records_granted_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_granted_by_user_id_foreign FOREIGN KEY (granted_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: consent_records consent_records_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: counselling_sessions counselling_sessions_counsellor_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counselling_sessions
    ADD CONSTRAINT counselling_sessions_counsellor_user_id_foreign FOREIGN KEY (counsellor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: counselling_sessions counselling_sessions_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counselling_sessions
    ADD CONSTRAINT counselling_sessions_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: counselling_sessions counselling_sessions_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counselling_sessions
    ADD CONSTRAINT counselling_sessions_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: counselling_sessions counselling_sessions_wellbeing_concern_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.counselling_sessions
    ADD CONSTRAINT counselling_sessions_wellbeing_concern_id_foreign FOREIGN KEY (wellbeing_concern_id) REFERENCES public.wellbeing_concerns(id) ON DELETE SET NULL;

--
-- Name: course_ratings course_ratings_course_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_ratings
    ADD CONSTRAINT course_ratings_course_id_foreign FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;

--
-- Name: course_ratings course_ratings_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_ratings
    ADD CONSTRAINT course_ratings_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: courses courses_recorded_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_recorded_by_user_id_foreign FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: courses courses_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: data_subject_requests data_subject_requests_handled_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_subject_requests
    ADD CONSTRAINT data_subject_requests_handled_by_user_id_foreign FOREIGN KEY (handled_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: data_subject_requests data_subject_requests_requester_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_subject_requests
    ADD CONSTRAINT data_subject_requests_requester_user_id_foreign FOREIGN KEY (requester_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: data_subject_requests data_subject_requests_subject_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_subject_requests
    ADD CONSTRAINT data_subject_requests_subject_user_id_foreign FOREIGN KEY (subject_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: districts districts_state_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.districts
    ADD CONSTRAINT districts_state_id_foreign FOREIGN KEY (state_id) REFERENCES public.states(id) ON DELETE CASCADE;

--
-- Name: external_exams external_exams_recorded_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_exams
    ADD CONSTRAINT external_exams_recorded_by_user_id_foreign FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: external_exams external_exams_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_exams
    ADD CONSTRAINT external_exams_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: facility_claims facility_claims_recorded_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_claims
    ADD CONSTRAINT facility_claims_recorded_by_user_id_foreign FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: facility_claims facility_claims_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_claims
    ADD CONSTRAINT facility_claims_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: facility_claims facility_claims_verified_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_claims
    ADD CONSTRAINT facility_claims_verified_by_user_id_foreign FOREIGN KEY (verified_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: facility_ratings facility_ratings_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_ratings
    ADD CONSTRAINT facility_ratings_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: fee_revisions fee_revisions_changed_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_revisions
    ADD CONSTRAINT fee_revisions_changed_by_user_id_foreign FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: fee_revisions fee_revisions_fee_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_revisions
    ADD CONSTRAINT fee_revisions_fee_id_foreign FOREIGN KEY (fee_id) REFERENCES public.fees(id) ON DELETE CASCADE;

--
-- Name: fee_revisions fee_revisions_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_revisions
    ADD CONSTRAINT fee_revisions_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: fees fees_recorded_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fees
    ADD CONSTRAINT fees_recorded_by_user_id_foreign FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: fees fees_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fees
    ADD CONSTRAINT fees_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: fraud_flags fraud_flags_reviewed_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_flags
    ADD CONSTRAINT fraud_flags_reviewed_by_user_id_foreign FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: growth_goals growth_goals_growth_plan_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_goals
    ADD CONSTRAINT growth_goals_growth_plan_id_foreign FOREIGN KEY (growth_plan_id) REFERENCES public.growth_plans(id) ON DELETE CASCADE;

--
-- Name: growth_plans growth_plans_created_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_plans
    ADD CONSTRAINT growth_plans_created_by_user_id_foreign FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: growth_plans growth_plans_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_plans
    ADD CONSTRAINT growth_plans_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: growth_plans growth_plans_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_plans
    ADD CONSTRAINT growth_plans_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: health_access_logs health_access_logs_actor_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_access_logs
    ADD CONSTRAINT health_access_logs_actor_user_id_foreign FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: health_access_logs health_access_logs_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_access_logs
    ADD CONSTRAINT health_access_logs_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: health_followups health_followups_opened_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_followups
    ADD CONSTRAINT health_followups_opened_by_user_id_foreign FOREIGN KEY (opened_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: health_followups health_followups_physical_health_record_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_followups
    ADD CONSTRAINT health_followups_physical_health_record_id_foreign FOREIGN KEY (physical_health_record_id) REFERENCES public.physical_health_records(id) ON DELETE SET NULL;

--
-- Name: health_followups health_followups_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_followups
    ADD CONSTRAINT health_followups_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: health_followups health_followups_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_followups
    ADD CONSTRAINT health_followups_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: identity_access_logs identity_access_logs_officer_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_access_logs
    ADD CONSTRAINT identity_access_logs_officer_user_id_foreign FOREIGN KEY (officer_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

--
-- Name: invitations invitations_accepted_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_accepted_by_user_id_foreign FOREIGN KEY (accepted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: invitations invitations_invited_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_user_id_foreign FOREIGN KEY (invited_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: invitations invitations_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: life_skills_tracking life_skills_tracking_recorded_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.life_skills_tracking
    ADD CONSTRAINT life_skills_tracking_recorded_by_user_id_foreign FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: life_skills_tracking life_skills_tracking_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.life_skills_tracking
    ADD CONSTRAINT life_skills_tracking_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: life_skills_tracking life_skills_tracking_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.life_skills_tracking
    ADD CONSTRAINT life_skills_tracking_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: model_has_permissions model_has_permissions_permission_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_has_permissions
    ADD CONSTRAINT model_has_permissions_permission_id_foreign FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;

--
-- Name: model_has_roles model_has_roles_role_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_has_roles
    ADD CONSTRAINT model_has_roles_role_id_foreign FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

--
-- Name: officer_jurisdictions officer_jurisdictions_district_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.officer_jurisdictions
    ADD CONSTRAINT officer_jurisdictions_district_id_foreign FOREIGN KEY (district_id) REFERENCES public.districts(id) ON DELETE CASCADE;

--
-- Name: officer_jurisdictions officer_jurisdictions_state_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.officer_jurisdictions
    ADD CONSTRAINT officer_jurisdictions_state_id_foreign FOREIGN KEY (state_id) REFERENCES public.states(id) ON DELETE CASCADE;

--
-- Name: officer_jurisdictions officer_jurisdictions_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.officer_jurisdictions
    ADD CONSTRAINT officer_jurisdictions_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: parent_profiles parent_profiles_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_profiles
    ADD CONSTRAINT parent_profiles_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: parent_school_relationships parent_school_relationships_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_school_relationships
    ADD CONSTRAINT parent_school_relationships_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: parent_school_relationships parent_school_relationships_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_school_relationships
    ADD CONSTRAINT parent_school_relationships_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: parent_school_relationships parent_school_relationships_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parent_school_relationships
    ADD CONSTRAINT parent_school_relationships_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: physical_health_records physical_health_records_recorded_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_health_records
    ADD CONSTRAINT physical_health_records_recorded_by_user_id_foreign FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: physical_health_records physical_health_records_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_health_records
    ADD CONSTRAINT physical_health_records_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: physical_health_records physical_health_records_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.physical_health_records
    ADD CONSTRAINT physical_health_records_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: retaliation_reports retaliation_reports_complaint_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retaliation_reports
    ADD CONSTRAINT retaliation_reports_complaint_id_foreign FOREIGN KEY (complaint_id) REFERENCES public.complaints(id) ON DELETE SET NULL;

--
-- Name: retaliation_reports retaliation_reports_district_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retaliation_reports
    ADD CONSTRAINT retaliation_reports_district_id_foreign FOREIGN KEY (district_id) REFERENCES public.districts(id) ON DELETE RESTRICT;

--
-- Name: retaliation_reports retaliation_reports_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retaliation_reports
    ADD CONSTRAINT retaliation_reports_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;

--
-- Name: retaliation_reports retaliation_reports_state_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retaliation_reports
    ADD CONSTRAINT retaliation_reports_state_id_foreign FOREIGN KEY (state_id) REFERENCES public.states(id) ON DELETE RESTRICT;

--
-- Name: role_has_permissions role_has_permissions_permission_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_has_permissions
    ADD CONSTRAINT role_has_permissions_permission_id_foreign FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;

--
-- Name: role_has_permissions role_has_permissions_role_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_has_permissions
    ADD CONSTRAINT role_has_permissions_role_id_foreign FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

--
-- Name: safeguarding_events safeguarding_events_actor_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_events
    ADD CONSTRAINT safeguarding_events_actor_user_id_foreign FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: safeguarding_events safeguarding_events_safeguarding_report_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_events
    ADD CONSTRAINT safeguarding_events_safeguarding_report_id_foreign FOREIGN KEY (safeguarding_report_id) REFERENCES public.safeguarding_reports(id) ON DELETE CASCADE;

--
-- Name: safeguarding_reports safeguarding_reports_assigned_officer_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_reports
    ADD CONSTRAINT safeguarding_reports_assigned_officer_user_id_foreign FOREIGN KEY (assigned_officer_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: safeguarding_reports safeguarding_reports_closed_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_reports
    ADD CONSTRAINT safeguarding_reports_closed_by_user_id_foreign FOREIGN KEY (closed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: safeguarding_reports safeguarding_reports_district_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_reports
    ADD CONSTRAINT safeguarding_reports_district_id_foreign FOREIGN KEY (district_id) REFERENCES public.districts(id) ON DELETE RESTRICT;

--
-- Name: safeguarding_reports safeguarding_reports_external_report_acknowledged_by_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_reports
    ADD CONSTRAINT safeguarding_reports_external_report_acknowledged_by_foreign FOREIGN KEY (external_report_acknowledged_by) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: safeguarding_reports safeguarding_reports_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_reports
    ADD CONSTRAINT safeguarding_reports_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE RESTRICT;

--
-- Name: safeguarding_reports safeguarding_reports_state_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safeguarding_reports
    ADD CONSTRAINT safeguarding_reports_state_id_foreign FOREIGN KEY (state_id) REFERENCES public.states(id) ON DELETE RESTRICT;

--
-- Name: school_feedback school_feedback_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_feedback
    ADD CONSTRAINT school_feedback_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: school_profiles school_profiles_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_profiles
    ADD CONSTRAINT school_profiles_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: school_quality_scores school_quality_scores_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_quality_scores
    ADD CONSTRAINT school_quality_scores_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: school_replies school_replies_author_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_replies
    ADD CONSTRAINT school_replies_author_user_id_foreign FOREIGN KEY (author_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: school_replies school_replies_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_replies
    ADD CONSTRAINT school_replies_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: school_staff school_staff_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_staff
    ADD CONSTRAINT school_staff_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: school_staff school_staff_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_staff
    ADD CONSTRAINT school_staff_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: schools schools_district_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_district_id_foreign FOREIGN KEY (district_id) REFERENCES public.districts(id) ON DELETE RESTRICT;

--
-- Name: schools schools_state_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_state_id_foreign FOREIGN KEY (state_id) REFERENCES public.states(id) ON DELETE RESTRICT;

--
-- Name: schools schools_udise_verified_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_udise_verified_by_user_id_foreign FOREIGN KEY (udise_verified_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: student_academic_records student_academic_records_recorded_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_academic_records
    ADD CONSTRAINT student_academic_records_recorded_by_user_id_foreign FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

--
-- Name: student_academic_records student_academic_records_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_academic_records
    ADD CONSTRAINT student_academic_records_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: student_academic_records student_academic_records_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_academic_records
    ADD CONSTRAINT student_academic_records_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: student_profiles student_profiles_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: student_school_relationships student_school_relationships_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_school_relationships
    ADD CONSTRAINT student_school_relationships_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: student_school_relationships student_school_relationships_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_school_relationships
    ADD CONSTRAINT student_school_relationships_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: teacher_effectiveness_scores teacher_effectiveness_scores_teacher_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_effectiveness_scores
    ADD CONSTRAINT teacher_effectiveness_scores_teacher_user_id_foreign FOREIGN KEY (teacher_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: teacher_feedback teacher_feedback_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_feedback
    ADD CONSTRAINT teacher_feedback_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: teacher_feedback teacher_feedback_teacher_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_feedback
    ADD CONSTRAINT teacher_feedback_teacher_user_id_foreign FOREIGN KEY (teacher_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: teacher_profiles teacher_profiles_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_profiles
    ADD CONSTRAINT teacher_profiles_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: teacher_school_relationships teacher_school_relationships_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_school_relationships
    ADD CONSTRAINT teacher_school_relationships_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: teacher_school_relationships teacher_school_relationships_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_school_relationships
    ADD CONSTRAINT teacher_school_relationships_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: two_factor_authentications two_factor_authentications_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.two_factor_authentications
    ADD CONSTRAINT two_factor_authentications_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: wellbeing_concerns wellbeing_concerns_raised_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellbeing_concerns
    ADD CONSTRAINT wellbeing_concerns_raised_by_user_id_foreign FOREIGN KEY (raised_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: wellbeing_concerns wellbeing_concerns_school_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellbeing_concerns
    ADD CONSTRAINT wellbeing_concerns_school_id_foreign FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

--
-- Name: wellbeing_concerns wellbeing_concerns_seen_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellbeing_concerns
    ADD CONSTRAINT wellbeing_concerns_seen_by_user_id_foreign FOREIGN KEY (seen_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: wellbeing_concerns wellbeing_concerns_student_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellbeing_concerns
    ADD CONSTRAINT wellbeing_concerns_student_user_id_foreign FOREIGN KEY (student_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- PostgreSQL database dump complete
--

-- Laravel's migrations log, so a later 'php artisan migrate' only runs NEW migrations.
INSERT INTO public.migrations VALUES
	(1, '0001_01_01_000000_create_users_table', 1),
	(2, '0001_01_01_000001_create_cache_table', 1),
	(3, '0001_01_01_000002_create_jobs_table', 1),
	(4, '2026_08_25_011344_create_permission_tables', 1),
	(5, '2026_08_25_044125_create_states_table', 1),
	(6, '2026_08_25_044126_create_districts_table', 1),
	(7, '2026_08_25_044127_create_schools_table', 1),
	(8, '2026_08_25_044128_create_school_profiles_table', 1),
	(9, '2026_08_25_044129_create_anonymous_identities_table', 1),
	(10, '2026_08_25_044130_create_parent_profiles_table', 1),
	(11, '2026_08_25_044131_create_student_profiles_table', 1),
	(12, '2026_08_25_044132_create_teacher_profiles_table', 1),
	(13, '2026_08_25_044133_create_school_staff_table', 1),
	(14, '2026_08_25_044134_create_parent_school_relationships_table', 1),
	(15, '2026_08_25_044135_create_student_school_relationships_table', 1),
	(16, '2026_08_25_044136_create_teacher_school_relationships_table', 1),
	(17, '2026_08_25_044137_create_complaint_categories_table', 1),
	(18, '2026_08_25_044138_create_complaints_table', 1),
	(19, '2026_08_25_044139_create_complaint_evidence_table', 1),
	(20, '2026_08_25_044140_create_complaint_responses_table', 1),
	(21, '2026_08_25_044141_create_complaint_status_history_table', 1),
	(22, '2026_08_25_044142_create_complaint_resolutions_table', 1),
	(23, '2026_08_25_044143_create_school_feedback_table', 1),
	(24, '2026_08_25_044144_create_school_rating_components_table', 1),
	(25, '2026_08_25_044145_create_school_quality_scores_table', 1),
	(26, '2026_08_25_044146_create_audit_logs_table', 1),
	(27, '2026_08_25_044147_create_identity_access_logs_table', 1),
	(28, '2026_08_25_044148_create_notifications_table', 1),
	(29, '2026_08_25_044427_create_officer_jurisdictions_table', 1),
	(30, '2026_08_26_023118_create_retaliation_reports_table', 1),
	(31, '2026_08_26_023130_create_teacher_feedback_table', 1),
	(32, '2026_08_26_023143_create_teacher_effectiveness_scores_table', 1),
	(33, '2026_08_26_024026_create_teacher_rating_components_table', 1),
	(34, '2026_08_26_071443_create_invitations_table', 1),
	(35, '2026_08_26_134827_create_student_academic_records_table', 1),
	(36, '2026_08_26_134833_create_fraud_flags_table', 1),
	(37, '2026_08_26_134834_create_appeals_table', 1),
	(38, '2026_08_26_134838_create_analytics_snapshots_table', 1),
	(39, '2026_08_26_134839_create_two_factor_authentications_table', 1),
	(40, '2026_08_26_134840_create_settings_table', 1),
	(41, '2026_09_02_100001_create_consent_records_table', 1),
	(42, '2026_09_02_100002_create_capability_observations_table', 1),
	(43, '2026_09_02_100003_create_growth_plans_table', 1),
	(44, '2026_09_02_100004_create_growth_goals_table', 1),
	(45, '2026_09_02_100005_create_career_interest_profiles_table', 1),
	(46, '2026_09_02_100006_create_life_skills_tracking_table', 1),
	(47, '2026_09_03_100001_add_udise_code_to_schools_table', 1),
	(48, '2026_09_03_100002_create_fees_table', 1),
	(49, '2026_09_03_100003_create_fee_revisions_table', 1),
	(50, '2026_09_03_100004_create_facility_claims_table', 1),
	(51, '2026_09_03_100005_create_facility_ratings_table', 1),
	(52, '2026_09_03_100006_create_safeguarding_reports_table', 1),
	(53, '2026_09_03_100007_create_safeguarding_events_table', 1),
	(54, '2026_09_03_100008_create_external_exams_table', 1),
	(55, '2026_09_03_100009_create_coaching_programmes_table', 1),
	(56, '2026_09_03_100010_create_physical_health_records_table', 1),
	(57, '2026_09_03_100011_create_wellbeing_concerns_table', 1),
	(58, '2026_09_03_100012_create_counselling_sessions_table', 1),
	(59, '2026_09_03_100013_create_health_followups_table', 1),
	(60, '2026_09_03_100014_create_health_access_logs_table', 1),
	(61, '2026_09_03_100015_create_benchmark_references_table', 1),
	(62, '2026_09_03_100016_create_courses_table', 1),
	(63, '2026_09_03_100017_create_course_ratings_table', 1),
	(64, '2026_09_03_100018_create_school_replies_table', 1),
	(65, '2026_09_03_100019_create_data_subject_requests_table', 1),
	(66, '2026_10_09_000000_make_user_email_case_insensitive_on_pgsql', 1) ON CONFLICT DO NOTHING;
SELECT pg_catalog.setval('public.migrations_id_seq', 66, true);
