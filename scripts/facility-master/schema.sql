PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE facilities (
  facility_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  report_display_name TEXT NOT NULL,
  city TEXT,
  uf TEXT,
  activity_status TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  trial_count INTEGER NOT NULL,
  active_trial_count INTEGER NOT NULL
);

CREATE TABLE source_records (
  source_record_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  city TEXT,
  uf TEXT,
  geo_method TEXT NOT NULL,
  membership_status TEXT NOT NULL,
  is_placeholder INTEGER NOT NULL
);

CREATE TABLE facility_identifiers (
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  system TEXT NOT NULL,
  value TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  source_record_id TEXT NOT NULL REFERENCES source_records(source_record_id),
  PRIMARY KEY (facility_id, system, value, source_record_id)
);

CREATE TABLE facility_aliases (
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  source_record_id TEXT NOT NULL REFERENCES source_records(source_record_id),
  PRIMARY KEY (facility_id, normalized_name, source_record_id)
);

CREATE TABLE facility_observations (
  observation_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  field_name TEXT NOT NULL,
  value_json TEXT NOT NULL,
  assertion TEXT NOT NULL,
  source_class TEXT NOT NULL,
  source_record_id TEXT NOT NULL REFERENCES source_records(source_record_id),
  observed_at TEXT
);

CREATE TABLE facility_trials (
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  trial_id TEXT NOT NULL,
  source_record_id TEXT NOT NULL REFERENCES source_records(source_record_id),
  PRIMARY KEY (facility_id, trial_id, source_record_id)
);

CREATE TABLE persons (
  person_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  identity_basis TEXT NOT NULL
);

CREATE TABLE person_facility_roles (
  person_id TEXT NOT NULL REFERENCES persons(person_id),
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  role TEXT NOT NULL,
  source_record_id TEXT NOT NULL REFERENCES source_records(source_record_id),
  PRIMARY KEY (person_id, facility_id, role, source_record_id)
);

CREATE TABLE resolution_issues (
  issue_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  source_record_ids_json TEXT NOT NULL,
  facility_ids_json TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE INDEX idx_facility_identifier ON facility_identifiers(system, value, validation_status);
CREATE INDEX idx_facility_alias ON facility_aliases(normalized_name);
CREATE INDEX idx_facility_location ON facilities(uf, city);
CREATE INDEX idx_facility_observation ON facility_observations(facility_id, field_name);
CREATE INDEX idx_facility_trial ON facility_trials(trial_id, facility_id);
CREATE INDEX idx_person_role_facility ON person_facility_roles(facility_id, role);
