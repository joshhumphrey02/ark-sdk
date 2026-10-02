import { INTEGRATIONS } from "../integrations/registry";
import type { Detection, Integration } from "../integrations/types";
import type { ProjectContext } from "./project";

export type Candidate = { integration: Integration; detection: Detection };

/** Every integration that recognises the project, most confident first. */
export function detectAll(context: ProjectContext): Candidate[] {
  return Object.values(INTEGRATIONS)
    .flatMap((integration) => {
      const detection = integration.detect(context);
      return detection ? [{ integration, detection }] : [];
    })
    .sort((a, b) => b.detection.confidence - a.detection.confidence);
}

/**
 * The integration to suggest, and the alternatives worth asking about: a tie,
 * or a strong match from another ecosystem (a Django app with a React folder).
 * Within one ecosystem the most specific wins: Next.js over React.
 */
export function choose(candidates: Candidate[]): { best: Candidate | null; contenders: Candidate[] } {
  const best = candidates[0] ?? null;
  if (!best) return { best: null, contenders: [] };
  const contenders = candidates.filter(
    (c) => c === best || c.detection.confidence === best.detection.confidence || (c.detection.confidence >= 50 && c.integration.ecosystem !== best.integration.ecosystem),
  );
  return { best, contenders };
}
