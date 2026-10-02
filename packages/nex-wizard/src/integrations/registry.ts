import { angular } from "./angular";
import { astro } from "./astro";
import { javascript } from "./javascript";
import { nextjs } from "./nextjs";
import { nodejs } from "./nodejs";
import { flutter, go, laravel, php, reactNative, ruby, springBoot, swift } from "./planned";
import { python } from "./python";
import { react } from "./react";
import { solid } from "./solid";
import { svelte } from "./svelte";
import { INTEGRATION_IDS, type Integration, type IntegrationId } from "./types";
import { vue } from "./vue";

/**
 * Every integration the wizard knows. Adding a framework is a new folder
 * under integrations/ and one line here; the wizard core doesn't change.
 */
export const INTEGRATIONS: Record<IntegrationId, Integration> = {
  nextjs,
  angular,
  flutter,
  "react-native": reactNative,
  python,
  nodejs,
  react,
  go,
  swift,
  ruby,
  php,
  laravel,
  "spring-boot": springBoot,
  vue,
  solid,
  svelte,
  astro,
  javascript,
};

export function isIntegrationId(value: string): value is IntegrationId {
  return (INTEGRATION_IDS as readonly string[]).includes(value);
}

export function getIntegration(id: IntegrationId): Integration {
  return INTEGRATIONS[id];
}

export const available = () => Object.values(INTEGRATIONS).filter((i) => i.status === "available");
export const planned = () => Object.values(INTEGRATIONS).filter((i) => i.status === "planned");
