import { WizardError } from "../core/errors";
import type { ProjectContext } from "../core/project";
import { hasDep } from "./shared";
import type { Detection, Integration, IntegrationId } from "./types";

/**
 * Frameworks Nex will support but has no SDK for yet. They are detected, so
 * the wizard can say so plainly instead of installing the wrong SDK; each
 * becomes "available" when its SDK ships (see docs: adding an integration).
 */
function planned(id: IntegrationId, name: string, ecosystem: Integration["ecosystem"], detect: (context: ProjectContext) => Detection | null): Integration {
  return {
    id,
    name,
    ecosystem,
    status: "planned",
    sdk: null,
    compatibility: [],
    detect,
    needs: () => ({ server: false, browser: false }),
    configure() {
      throw new WizardError(`A Nex SDK for ${name} isn't available yet.`, "Nex supports JavaScript (Next.js, React, Vue, Angular, Svelte, Solid, Astro, Node.js) and Python today. Follow the Nex changelog for new SDKs.", 2);
    },
    instrumentationFiles: () => [],
  };
}

const text = (context: ProjectContext, path: string) => context.files.read(path) ?? "";

export const reactNative = planned("react-native", "React Native", "javascript", (c) => (hasDep(c, "react-native") ? { confidence: 98, signals: ["react-native dependency"] } : null));
export const flutter = planned("flutter", "Flutter", "dart", (c) => (c.files.exists("pubspec.yaml") ? { confidence: 90, signals: ["pubspec.yaml"] } : null));
export const go = planned("go", "Go", "go", (c) => (c.files.exists("go.mod") ? { confidence: 90, signals: ["go.mod"] } : null));
export const swift = planned("swift", "Swift", "swift", (c) =>
  c.files.exists("Package.swift") || c.files.list().some((name) => name.endsWith(".xcodeproj")) ? { confidence: 85, signals: [c.files.exists("Package.swift") ? "Package.swift" : "Xcode project"] } : null,
);
export const laravel = planned("laravel", "Laravel", "php", (c) => (c.files.exists("artisan") && /laravel\/framework/.test(text(c, "composer.json")) ? { confidence: 95, signals: ["artisan", "laravel/framework"] } : null));
export const php = planned("php", "PHP", "php", (c) => (c.files.exists("composer.json") ? { confidence: 70, signals: ["composer.json"] } : null));
export const ruby = planned("ruby", "Ruby", "ruby", (c) => (c.files.exists("Gemfile") ? { confidence: 80, signals: ["Gemfile", ...(/\brails\b/.test(text(c, "Gemfile")) ? ["Rails"] : [])] } : null));
export const springBoot = planned("spring-boot", "Spring Boot", "java", (c) => {
  const build = text(c, "pom.xml") + text(c, "build.gradle") + text(c, "build.gradle.kts");
  return /spring-boot/.test(build) ? { confidence: 90, signals: [c.files.exists("pom.xml") ? "pom.xml" : "build.gradle", "spring-boot"] } : null;
});
