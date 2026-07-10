/**
 * Public entry point for the intake layer. `defaultRegistry()` wires up every
 * shipped adapter in one place; callers just `ingest(input)`.
 *
 * Adapters are added here as they land (F001 ctgov; F004 document; F005 fhir;
 * F006 euctr; F008–F010 long tail). Order doesn't matter — selection is by
 * `detect` score, not registration order.
 */

import { IntakeRegistry } from "./registry";
import { ctgovAdapter } from "./adapters/ctgov";
import { documentAdapter } from "./adapters/document";
import { fhirAdapter } from "./adapters/fhir";
import { euctrAdapter } from "./adapters/euctr";

export type {
  IntakeInput,
  IntakeResult,
  ProtocolMeta,
  Provenance,
  SourceAdapter,
  ExtractionMethod,
  TrustTier,
} from "./types";
export { IntakeRegistry } from "./registry";

/** A registry with all shipped adapters registered. */
export function defaultRegistry(): IntakeRegistry {
  return new IntakeRegistry()
    .register(ctgovAdapter)
    .register(documentAdapter)
    .register(fhirAdapter)
    .register(euctrAdapter);
}
