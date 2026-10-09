import type { Operation } from "@fleetfrog/protocol/domain/checkout";
import type { MachineKind, Platform } from "@fleetfrog/protocol/domain/machine";
import type { ProjectIconColor, T3CodeThreadState } from "@fleetfrog/protocol/domain/t3Code";

import type { DemoIconName } from "./demoIcons.ts";

export type DemoMachineKey = "macbook" | "studio" | "workstation" | "homelab" | "devbox";

export type DemoRoot = "projects" | "work";

export interface DemoMachine {
  readonly key: DemoMachineKey;
  readonly hostname: string;
  readonly prettyName: string | null;
  readonly platform: Platform;
  readonly kind: MachineKind;
  readonly os: string;
  readonly model: { readonly name: string; readonly detail: string | null } | null;
  readonly hypervisor: string | null;
  readonly architecture: string;
  readonly cpu: { readonly model: string; readonly cores: number };
  readonly memoryGiB: number;
  readonly disk: { readonly totalGiB: number; readonly freeGiB: number };
  readonly memoryUsedGiB: number;
  readonly load: number;
  readonly bootedDaysAgo: number;
  readonly pairedDaysAgo: number;
  readonly home: string;
  readonly roots: Readonly<Record<DemoRoot, string>>;
  readonly archive: string | null;
  readonly t3Code: boolean;
  readonly gitVersion: string;
  readonly nodeVersion: string | null;
  readonly trash: ReadonlyArray<DemoTrashedCheckout>;
}

export interface DemoTrashedCheckout {
  readonly remote: DemoRemote;
  readonly folder: string;
  readonly branch: string;
  readonly subject: string;
  readonly committedDaysAgo: number;
  readonly trashedDaysAgo: number;
  readonly sizeMiB: number;
}

export type DemoProjectIcon =
  | { readonly _tag: "Image"; readonly icon: DemoIconName }
  | { readonly _tag: "Lucide"; readonly name: string; readonly color: ProjectIconColor }
  | { readonly _tag: "Emoji"; readonly emoji: string }
  | { readonly _tag: "Monogram"; readonly text: string; readonly color: ProjectIconColor };

export type DemoRemote =
  | { readonly _tag: "Remote"; readonly host: string; readonly path: string }
  | { readonly _tag: "Local"; readonly rootCommit: string };

export interface DemoThread {
  readonly title: string;
  readonly state: T3CodeThreadState;
  readonly minutesAgo: number;
}

export interface DemoBranch {
  readonly name: string;
  readonly commits: ReadonlyArray<string>;
  readonly minutesAgo: number;
  readonly unpushed?: number;
  readonly behind?: number;
  readonly upstream?: "Tracking" | "None" | "Gone";
  readonly merged?: boolean;
}

export interface DemoWorktree {
  readonly folder: string;
  readonly branch: DemoBranch;
  readonly changes?: ReadonlyArray<string>;
  readonly threads?: ReadonlyArray<DemoThread>;
}

export interface DemoCheckout {
  readonly branch?: DemoBranch;
  readonly branches?: ReadonlyArray<DemoBranch>;
  readonly behind?: number;
  readonly unfetched?: number;
  readonly unpushed?: ReadonlyArray<string>;
  readonly changes?: ReadonlyArray<string>;
  readonly stashes?: ReadonlyArray<string>;
  readonly operation?: Operation;
  readonly threads?: ReadonlyArray<DemoThread>;
  readonly worktrees?: ReadonlyArray<DemoWorktree>;
  readonly fetchedMinutesAgo?: number;
  readonly archivedDaysAgo?: number;
  readonly deletedBranches?: ReadonlyArray<{ readonly name: string; readonly daysAgo: number }>;
  readonly droppedStashes?: ReadonlyArray<{ readonly message: string; readonly daysAgo: number }>;
}

export interface DemoPullRequest {
  readonly number: number;
  readonly title: string;
  readonly branch: string;
  readonly draft?: boolean;
  readonly merged?: boolean;
}

export interface DemoRepository {
  readonly key: string;
  readonly remote: DemoRemote;
  readonly folder: string;
  readonly root: DemoRoot;
  readonly defaultBranch: string;
  readonly project: { readonly title: string; readonly icon: DemoProjectIcon } | null;
  readonly history: ReadonlyArray<string>;
  readonly minutesBetweenCommits: number;
  readonly latestMinutesAgo: number;
  readonly pullRequests?: ReadonlyArray<DemoPullRequest>;
  readonly checkouts: Partial<Record<DemoMachineKey, DemoCheckout>>;
}

export interface DemoLayout {
  readonly pinned: ReadonlyArray<string>;
  readonly groups: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly repositories: ReadonlyArray<string>;
  }>;
}

const hour = 60;
const day = 24 * hour;

function github(path: string): DemoRemote {
  return { _tag: "Remote", host: "github.com", path };
}

export const demoGithubLogin = "pondhopper";

export const demoMachines: ReadonlyArray<DemoMachine> = [
  {
    key: "macbook",
    hostname: "kits-macbook-pro",
    prettyName: "MacBook Pro",
    platform: "darwin",
    kind: "laptop",
    os: "macOS 26.1",
    model: { name: "MacBook Pro", detail: "16-inch, 2024" },
    hypervisor: null,
    architecture: "arm64",
    cpu: { model: "Apple M4 Max", cores: 16 },
    memoryGiB: 64,
    memoryUsedGiB: 41,
    disk: { totalGiB: 1858, freeGiB: 612 },
    load: 3.2,
    bootedDaysAgo: 6,
    pairedDaysAgo: 142,
    home: "/Users/kit",
    roots: { projects: "/Users/kit/Projects", work: "/Users/kit/Work" },
    archive: "/Users/kit/Archive",
    t3Code: true,
    gitVersion: "2.51.1",
    nodeVersion: "26.11.1",
    trash: [
      {
        remote: github("pondhopper/websocket-playground"),
        folder: "websocket-playground",
        branch: "main",
        subject: "Try a reconnecting client",
        committedDaysAgo: 210,
        trashedDaysAgo: 3,
        sizeMiB: 186,
      },
    ],
  },
  {
    key: "studio",
    hostname: "studio",
    prettyName: "Mac Studio",
    platform: "darwin",
    kind: "mac-studio",
    os: "macOS 26.1",
    model: { name: "Mac Studio", detail: "2025" },
    hypervisor: null,
    architecture: "arm64",
    cpu: { model: "Apple M3 Ultra", cores: 28 },
    memoryGiB: 96,
    memoryUsedGiB: 58,
    disk: { totalGiB: 3720, freeGiB: 2210 },
    load: 5.8,
    bootedDaysAgo: 23,
    pairedDaysAgo: 131,
    home: "/Users/kit",
    roots: { projects: "/Users/kit/Projects", work: "/Users/kit/Work" },
    archive: "/Users/kit/Archive",
    t3Code: true,
    gitVersion: "2.51.1",
    nodeVersion: "26.11.1",
    trash: [],
  },
  {
    key: "workstation",
    hostname: "workstation",
    prettyName: null,
    platform: "linux",
    kind: "desktop",
    os: "Ubuntu 26.04 LTS",
    model: { name: "X870E Taichi", detail: "ASRock" },
    hypervisor: null,
    architecture: "x86_64",
    cpu: { model: "AMD Ryzen 9 9950X", cores: 32 },
    memoryGiB: 128,
    memoryUsedGiB: 37,
    disk: { totalGiB: 3726, freeGiB: 1890 },
    load: 2.4,
    bootedDaysAgo: 11,
    pairedDaysAgo: 128,
    home: "/home/kit",
    roots: { projects: "/home/kit/src", work: "/home/kit/work" },
    archive: "/home/kit/archive",
    t3Code: true,
    gitVersion: "2.51.0",
    nodeVersion: "26.11.1",
    trash: [],
  },
  {
    key: "homelab",
    hostname: "homelab",
    prettyName: null,
    platform: "linux",
    kind: "server",
    os: "Debian GNU/Linux 13 (trixie)",
    model: { name: "Standard PC (Q35 + ICH9, 2009)", detail: "QEMU" },
    hypervisor: "kvm",
    architecture: "x86_64",
    cpu: { model: "Intel(R) N305", cores: 8 },
    memoryGiB: 32,
    memoryUsedGiB: 19,
    disk: { totalGiB: 1862, freeGiB: 744 },
    load: 0.9,
    bootedDaysAgo: 64,
    pairedDaysAgo: 97,
    home: "/home/kit",
    roots: { projects: "/home/kit/src", work: "/home/kit/work" },
    archive: null,
    t3Code: false,
    gitVersion: "2.47.3",
    nodeVersion: null,
    trash: [],
  },
  {
    key: "devbox",
    hostname: "devbox",
    prettyName: null,
    platform: "linux",
    kind: "cloud",
    os: "Ubuntu 24.04.3 LTS",
    model: null,
    hypervisor: "kvm",
    architecture: "aarch64",
    cpu: { model: "Neoverse-N1", cores: 16 },
    memoryGiB: 32,
    memoryUsedGiB: 12,
    disk: { totalGiB: 320, freeGiB: 141 },
    load: 1.3,
    bootedDaysAgo: 18,
    pairedDaysAgo: 54,
    home: "/home/kit",
    roots: { projects: "/home/kit/src", work: "/home/kit/work" },
    archive: "/home/kit/archive",
    t3Code: true,
    gitVersion: "2.43.0",
    nodeVersion: "26.11.1",
    trash: [],
  },
];

export const demoRepositories: ReadonlyArray<DemoRepository> = [
  {
    key: "fleetfrog",
    remote: github("jameswyse/fleetfrog"),
    folder: "fleetfrog",
    root: "projects",
    defaultBranch: "main",
    project: { title: "FleetFrog", icon: { _tag: "Image", icon: "fleetfrog" } },
    history: [
      "feat(web): group projects into sections",
      "fix(agent): read T3 Code's schema at migration 60",
      "feat(hub): show agent updates in Settings › Fleet",
      "chore(deps): upgrade dependencies, Node.js and pnpm",
      "fix(web): keep the grid's header in view while scrolling",
      "feat(agent): stash changes before switching branches",
    ],
    minutesBetweenCommits: 7 * hour,
    latestMinutesAgo: 95,
    pullRequests: [
      { number: 47, title: "Run the hub with a demo fleet", branch: "feat/demo-fleet" },
      { number: 44, title: "Keep the grid's header in view", branch: "fix/sticky-header" },
      {
        number: 41,
        title: "Clearer pairing instructions",
        branch: "fix/pairing-copy",
        merged: true,
      },
    ],
    checkouts: {
      macbook: {
        branch: {
          name: "feat/demo-fleet",
          commits: [
            "feat(hub): simulate agents for the demo fleet",
            "feat(hub): seed the demo with projects and machines",
          ],
          unpushed: 1,
          minutesAgo: 18,
        },
        branches: [
          {
            name: "fix/pairing-copy",
            commits: ["fix(web): clearer pairing instructions"],
            minutesAgo: 6 * day,
            merged: true,
          },
        ],
        changes: [
          ".M apps/hub/src/demo/simulatedAgent.ts",
          ".M apps/hub/src/main.ts",
          "?? apps/hub/src/demo/demoFleetData.ts",
        ],
        threads: [{ title: "Add a demo mode to the hub", state: "Working", minutesAgo: 1 }],
        worktrees: [
          {
            folder: "fleetfrog-sticky-header",
            branch: {
              name: "fix/sticky-header",
              commits: ["fix(web): keep the grid's header in view while scrolling"],
              minutesAgo: 3 * hour,
            },
            threads: [{ title: "Fix the grid's sticky header", state: "Idle", minutesAgo: 170 }],
          },
        ],
        deletedBranches: [{ name: "spike/sqlite-wal", daysAgo: 2 }],
        fetchedMinutesAgo: 12,
      },
      studio: { fetchedMinutesAgo: 40 },
      workstation: { behind: 3, fetchedMinutesAgo: 70 },
      homelab: { fetchedMinutesAgo: 25 },
      devbox: { fetchedMinutesAgo: 30 },
    },
  },
  {
    key: "lilypad-api",
    remote: github("lilypad-hq/api"),
    folder: "api",
    root: "work",
    defaultBranch: "main",
    project: { title: "Lilypad API", icon: { _tag: "Lucide", name: "zap", color: "amber" } },
    history: [
      "Retry webhook deliveries with backoff",
      "Add an index for invoices by customer",
      "Return 409 when an idempotency key is reused",
      "Upgrade Postgres driver",
      "Log slow queries over 200 ms",
    ],
    minutesBetweenCommits: 5 * hour,
    latestMinutesAgo: 50,
    pullRequests: [
      { number: 1284, title: "Cap webhook retries at 24 hours", branch: "fix/webhook-retries" },
      { number: 1279, title: "Rate limit by API key", branch: "feat/rate-limits", draft: true },
    ],
    checkouts: {
      macbook: {
        branch: {
          name: "fix/webhook-retries",
          commits: ["Cap webhook retries at 24 hours", "Test retry schedule edges"],
          minutesAgo: 35,
        },
        changes: [".M src/webhooks/deliver.ts", ".M src/webhooks/deliver.test.ts"],
        threads: [
          { title: "Cap webhook retries at a day", state: "Waiting", minutesAgo: 4 },
          { title: "Explain the invoice index", state: "Idle", minutesAgo: 2 * day },
        ],
        fetchedMinutesAgo: 20,
      },
      studio: { unfetched: 2, fetchedMinutesAgo: 9 * hour },
      devbox: {
        branch: {
          name: "feat/rate-limits",
          commits: ["Rate limit by API key", "Share limits across instances with Redis"],
          minutesAgo: 5 * hour,
        },
        fetchedMinutesAgo: 30,
      },
    },
  },
  {
    key: "lilypad-web",
    remote: github("lilypad-hq/web"),
    folder: "web",
    root: "work",
    defaultBranch: "main",
    project: { title: "Lilypad Web", icon: { _tag: "Lucide", name: "globe", color: "sky" } },
    history: [
      "Show plan limits on the billing page",
      "Fix focus order in the invite dialog",
      "Move dashboard charts to the new tokens",
      "Lazy load the onboarding checklist",
    ],
    minutesBetweenCommits: 4 * hour,
    latestMinutesAgo: 3 * hour,
    pullRequests: [
      { number: 812, title: "Redesign checkout", branch: "feat/checkout-v2", draft: true },
    ],
    checkouts: {
      macbook: {
        stashes: [
          "WIP on main: try a sticky summary bar",
          "On main: invite dialog spacing experiments",
        ],
        droppedStashes: [{ message: "On main: old chart colours", daysAgo: 4 }],
        fetchedMinutesAgo: 20,
      },
      studio: {
        branch: {
          name: "feat/checkout-v2",
          commits: [
            "Split checkout into steps",
            "Add order summary card",
            "Validate addresses inline",
            "Remember the last payment method",
          ],
          unpushed: 4,
          minutesAgo: 12,
        },
        changes: [
          ".M src/checkout/CheckoutPage.tsx",
          ".M src/checkout/steps.ts",
          "A. src/checkout/OrderSummary.tsx",
          "?? src/checkout/OrderSummary.test.tsx",
          "?? src/checkout/addresses.ts",
        ],
        threads: [{ title: "Redesign the checkout flow", state: "Working", minutesAgo: 1 }],
        fetchedMinutesAgo: 45,
      },
      devbox: { fetchedMinutesAgo: 30 },
    },
  },
  {
    key: "lilypad-mobile",
    remote: github("lilypad-hq/mobile"),
    folder: "mobile",
    root: "work",
    defaultBranch: "main",
    project: {
      title: "Lilypad Mobile",
      icon: { _tag: "Lucide", name: "smartphone", color: "violet" },
    },
    history: [
      "Bump build number for 3.2.1",
      "Handle expired sessions on resume",
      "Cache avatars on disk",
      "Fix dark mode in receipts",
      "Ask for notification permission later",
      "Add haptics to the pay button",
      "Update Expo SDK",
    ],
    minutesBetweenCommits: 6 * hour,
    latestMinutesAgo: 2 * hour,
    checkouts: {
      macbook: {
        branch: {
          name: "release/3.2",
          commits: ["Bump build number for 3.2.1"],
          minutesAgo: 2 * day,
        },
        branches: [
          {
            name: "feat/offline-receipts",
            commits: ["Queue receipts offline"],
            minutesAgo: 9 * day,
          },
          {
            name: "fix/android-back",
            commits: ["Respect the Android back gesture"],
            minutesAgo: 13 * day,
          },
        ],
        fetchedMinutesAgo: 20,
      },
      studio: { behind: 6, fetchedMinutesAgo: 40 },
    },
  },
  {
    key: "design-system",
    remote: github("lilypad-hq/design-system"),
    folder: "design-system",
    root: "work",
    defaultBranch: "main",
    project: { title: "Design System", icon: { _tag: "Emoji", emoji: "🎨" } },
    history: [
      "Publish 4.12.0",
      "Add a compact size to Select",
      "Darken the focus ring in dark mode",
      "Document spacing tokens",
    ],
    minutesBetweenCommits: day,
    latestMinutesAgo: 20 * hour,
    pullRequests: [{ number: 233, title: "Colour tokens v2", branch: "feat/tokens-v2" }],
    checkouts: {
      macbook: {
        branch: {
          name: "feat/tokens-v2",
          commits: ["Rename colour tokens by role", "Generate tokens for both themes"],
          unpushed: 1,
          minutesAgo: 80,
        },
        fetchedMinutesAgo: 20,
      },
      studio: { fetchedMinutesAgo: 40 },
      workstation: { fetchedMinutesAgo: 70 },
    },
  },
  {
    key: "ops-runbooks",
    remote: github("lilypad-hq/ops-runbooks"),
    folder: "ops-runbooks",
    root: "work",
    defaultBranch: "main",
    project: null,
    history: [
      "Add a runbook for queue backlogs",
      "Update on-call escalation contacts",
      "Document the database failover drill",
    ],
    minutesBetweenCommits: 3 * day,
    latestMinutesAgo: 2 * day,
    checkouts: {
      macbook: { fetchedMinutesAgo: 20 },
      devbox: { changes: [".M runbooks/queue-backlog.md"], fetchedMinutesAgo: 30 },
    },
  },
  {
    key: "terraform-modules",
    remote: github("lilypad-hq/terraform-modules"),
    folder: "terraform-modules",
    root: "work",
    defaultBranch: "main",
    project: null,
    history: [
      "Pin the AWS provider to 6.x",
      "Add lifecycle rules to log buckets",
      "Tag every resource with its cost centre",
    ],
    minutesBetweenCommits: 2 * day,
    latestMinutesAgo: 30 * hour,
    checkouts: {
      workstation: { fetchedMinutesAgo: 70 },
      devbox: {
        branch: {
          name: "feat/eks-1-34",
          commits: ["Upgrade EKS to 1.34", "Move node groups to Graviton"],
          unpushed: 2,
          minutesAgo: 3 * hour,
        },
        changes: [".M modules/eks/variables.tf"],
        fetchedMinutesAgo: 30,
      },
    },
  },
  {
    key: "astro",
    remote: github("withastro/astro"),
    folder: "astro",
    root: "projects",
    defaultBranch: "main",
    project: { title: "Astro", icon: { _tag: "Image", icon: "astro" } },
    history: [
      "fix: preserve trailing slashes in redirects",
      "feat(content): faster collection loading",
      "chore: update dependencies",
      "fix(dev): restart the server when the config changes",
    ],
    minutesBetweenCommits: 2 * hour,
    latestMinutesAgo: 40,
    checkouts: {
      macbook: { fetchedMinutesAgo: 20 },
      studio: { unfetched: 5, fetchedMinutesAgo: 2 * day },
    },
  },
  {
    key: "bun",
    remote: github("oven-sh/bun"),
    folder: "bun",
    root: "projects",
    defaultBranch: "main",
    project: { title: "Bun", icon: { _tag: "Image", icon: "bun" } },
    history: [
      "Faster `bun install` lockfile parsing",
      "fix(node:http): handle aborted requests",
      "Update WebKit",
      "bun test: support --bail with a count",
      "fix(bundler): keep comments in CSS output",
    ],
    minutesBetweenCommits: 45,
    latestMinutesAgo: 25,
    checkouts: {
      workstation: { behind: 27, fetchedMinutesAgo: 70 },
    },
  },
  {
    key: "effect",
    remote: github("Effect-TS/effect"),
    folder: "effect",
    root: "projects",
    defaultBranch: "main",
    project: { title: "Effect", icon: { _tag: "Image", icon: "effect" } },
    history: [
      "fix(Stream): interrupt the upstream on timeout",
      "feat(Schema): add Schema.TemplateLiteralParser",
      "docs: clarify Layer.provideMerge",
      "fix(rpc): flush acknowledgements before closing",
    ],
    minutesBetweenCommits: 3 * hour,
    latestMinutesAgo: 2 * hour,
    pullRequests: [
      {
        number: 5921,
        title: "Interrupt the upstream when a stream times out",
        branch: "fix/stream-timeout",
      },
    ],
    checkouts: {
      macbook: { fetchedMinutesAgo: 20 },
      studio: {
        branch: {
          name: "fix/stream-timeout",
          commits: [
            "fix(Stream): interrupt the upstream on timeout",
            "test(Stream): cover timeouts with finalizers",
            "docs(Stream): note interruption on timeout",
          ],
          unpushed: 3,
          minutesAgo: 50,
        },
        fetchedMinutesAgo: 40,
      },
      workstation: { fetchedMinutesAgo: 70 },
    },
  },
  {
    key: "excalidraw",
    remote: github("excalidraw/excalidraw"),
    folder: "excalidraw",
    root: "projects",
    defaultBranch: "master",
    project: { title: "Excalidraw", icon: { _tag: "Image", icon: "excalidraw" } },
    history: [
      "feat: snap arrows to element midpoints",
      "fix: text wrapping in containers",
      "perf: cache rough.js shapes per zoom level",
      "chore: bump dependencies",
    ],
    minutesBetweenCommits: 9 * hour,
    latestMinutesAgo: 5 * hour,
    checkouts: {
      macbook: { fetchedMinutesAgo: 20 },
      studio: {
        branch: {
          name: "feat/arrow-snap",
          commits: ["feat: snap arrows to element midpoints"],
          unpushed: 1,
          minutesAgo: 4 * hour,
        },
        operation: "rebase",
        changes: [
          "UU packages/excalidraw/element/binding.ts",
          "M. packages/excalidraw/element/arrows.ts",
        ],
        fetchedMinutesAgo: 4 * hour,
      },
    },
  },
  {
    key: "oxc",
    remote: github("oxc-project/oxc"),
    folder: "oxc",
    root: "projects",
    defaultBranch: "main",
    project: { title: "Oxc", icon: { _tag: "Image", icon: "oxc" } },
    history: [
      "perf(lexer): skip whitespace with SIMD",
      "feat(linter): add no-useless-spread",
      "fix(parser): report duplicate exports",
      "refactor(semantic): store scopes in an arena",
    ],
    minutesBetweenCommits: 80,
    latestMinutesAgo: 30,
    checkouts: {
      macbook: { fetchedMinutesAgo: 20 },
      workstation: {
        branch: {
          name: "perf/lexer-simd",
          commits: [
            "perf(lexer): skip whitespace with SIMD",
            "perf(lexer): scan identifiers 16 bytes at a time",
            "bench: add a large TypeScript fixture",
            "perf(lexer): avoid bounds checks in the hot loop",
            "test(lexer): fuzz the SIMD paths",
          ],
          unpushed: 5,
          upstream: "None",
          minutesAgo: 9,
        },
        changes: [
          ".M crates/oxc_parser/src/lexer/mod.rs",
          ".M crates/oxc_parser/src/lexer/simd.rs",
          ".M tasks/benchmark/benches/lexer.rs",
          "?? crates/oxc_parser/src/lexer/simd_neon.rs",
        ],
        threads: [{ title: "Vectorise the lexer's hot loop", state: "Working", minutesAgo: 1 }],
        fetchedMinutesAgo: 70,
      },
    },
  },
  {
    key: "t3code",
    remote: github("pingdotgg/t3code"),
    folder: "t3code",
    root: "projects",
    defaultBranch: "main",
    project: { title: "T3 Code", icon: { _tag: "Image", icon: "t3Code" } },
    history: [
      "Show provider status in settings",
      "Keep thread snapshots in a window",
      "Fix worktree cleanup on archive",
    ],
    minutesBetweenCommits: 5 * hour,
    latestMinutesAgo: 3 * hour,
    checkouts: {
      macbook: { fetchedMinutesAgo: 20 },
      studio: { fetchedMinutesAgo: 40 },
      workstation: { fetchedMinutesAgo: 70 },
      devbox: { behind: 2, fetchedMinutesAgo: 30 },
    },
  },
  {
    key: "tailwindcss",
    remote: github("tailwindlabs/tailwindcss"),
    folder: "tailwindcss",
    root: "projects",
    defaultBranch: "main",
    project: { title: "Tailwind CSS", icon: { _tag: "Image", icon: "tailwindCss" } },
    history: [
      "Support `@variant` inside `@utility`",
      "Fix sorting of arbitrary properties",
      "Improve candidate extraction in Svelte files",
    ],
    minutesBetweenCommits: 6 * hour,
    latestMinutesAgo: 4 * hour,
    checkouts: {
      macbook: { unfetched: 3, fetchedMinutesAgo: day },
      studio: { fetchedMinutesAgo: 40 },
    },
  },
  {
    key: "tanstack-router",
    remote: github("TanStack/router"),
    folder: "router",
    root: "projects",
    defaultBranch: "main",
    project: { title: "TanStack Router", icon: { _tag: "Image", icon: "tanStack" } },
    history: [
      "fix: preserve search params on redirect",
      "feat: typed route masks",
      "docs: loader deps",
    ],
    minutesBetweenCommits: 7 * hour,
    latestMinutesAgo: 6 * hour,
    checkouts: {
      macbook: { fetchedMinutesAgo: 20 },
      workstation: { fetchedMinutesAgo: 70 },
    },
  },
  {
    key: "vite",
    remote: github("vitejs/vite"),
    folder: "vite",
    root: "projects",
    defaultBranch: "main",
    project: { title: "Vite", icon: { _tag: "Image", icon: "vite" } },
    history: [
      "fix(css): keep import order for lazy chunks",
      "feat(env): support `envPrefix` arrays",
      "perf(hmr): batch updates within a frame",
      "fix(ssr): handle circular imports in the module graph",
      "chore(deps): update rolldown",
      "docs: explain the environment API",
      "fix(optimizer): rerun when the lockfile changes",
      "test: stabilise the HMR playground",
      "refactor: share the resolver between environments",
    ],
    minutesBetweenCommits: 3 * hour,
    latestMinutesAgo: 70,
    pullRequests: [
      {
        number: 21134,
        title: "fix(css): keep import order for lazy chunks",
        branch: "fix/css-import-order",
      },
    ],
    checkouts: {
      macbook: { behind: 8, fetchedMinutesAgo: 20 },
      workstation: {
        branch: {
          name: "fix/css-import-order",
          commits: ["fix(css): keep import order for lazy chunks"],
          minutesAgo: 6 * hour,
        },
        changes: [".M packages/vite/src/node/plugins/css.ts"],
        fetchedMinutesAgo: 70,
      },
    },
  },
  {
    key: "home-assistant",
    remote: github("home-assistant/core"),
    folder: "home-assistant-core",
    root: "projects",
    defaultBranch: "dev",
    project: { title: "Home Assistant", icon: { _tag: "Image", icon: "homeAssistant" } },
    history: [
      "Add energy sensors to the Shelly integration",
      "Bump aiohttp to 3.13",
      "Fix unit conversion for wind speed",
    ],
    minutesBetweenCommits: 30,
    latestMinutesAgo: 15,
    checkouts: {
      homelab: { fetchedMinutesAgo: 25 },
      workstation: { behind: 14, fetchedMinutesAgo: 70 },
    },
  },
  {
    key: "immich",
    remote: github("immich-app/immich"),
    folder: "immich",
    root: "projects",
    defaultBranch: "main",
    project: { title: "Immich", icon: { _tag: "Image", icon: "immich" } },
    history: [
      "feat: faster thumbnail generation",
      "fix(web): album sharing for partners",
      "chore: update machine learning models",
    ],
    minutesBetweenCommits: 4 * hour,
    latestMinutesAgo: 3 * hour,
    checkouts: {
      homelab: { fetchedMinutesAgo: 25 },
    },
  },
  {
    key: "homelab",
    remote: { _tag: "Remote", host: "gitea.pond.example", path: "kit/homelab" },
    folder: "homelab",
    root: "projects",
    defaultBranch: "main",
    project: { title: "Homelab", icon: { _tag: "Lucide", name: "server", color: "green" } },
    history: [
      "Move Immich to its own VM",
      "Back up Postgres nightly",
      "Add a Grafana dashboard for the UPS",
      "Renew certificates with DNS challenges",
    ],
    minutesBetweenCommits: 2 * day,
    latestMinutesAgo: day,
    checkouts: {
      macbook: { fetchedMinutesAgo: 20 },
      workstation: { fetchedMinutesAgo: 70 },
      homelab: {
        changes: [".M stacks/immich/compose.yaml", ".M stacks/monitoring/grafana.ini"],
        fetchedMinutesAgo: 25,
      },
    },
  },
  {
    key: "dotfiles",
    remote: github("pondhopper/dotfiles"),
    folder: "dotfiles",
    root: "projects",
    defaultBranch: "main",
    project: { title: "dotfiles", icon: { _tag: "Lucide", name: "terminal", color: "gray" } },
    history: [
      "Use zoxide for cd",
      "Add a Ghostty theme",
      "Sign commits with SSH keys",
      "Alias gs to git status --short",
    ],
    minutesBetweenCommits: 4 * day,
    latestMinutesAgo: 2 * day,
    checkouts: {
      macbook: { fetchedMinutesAgo: 20 },
      studio: { changes: [".M ghostty/config"], fetchedMinutesAgo: 40 },
      workstation: { fetchedMinutesAgo: 70 },
      homelab: { fetchedMinutesAgo: 25 },
      devbox: { behind: 2, fetchedMinutesAgo: 30 },
    },
  },
  {
    key: "recipe-box",
    remote: github("pondhopper/recipe-box"),
    folder: "recipe-box",
    root: "projects",
    defaultBranch: "main",
    project: { title: "Recipe Box", icon: { _tag: "Emoji", emoji: "🍜" } },
    history: ["Scale ingredients by servings", "Import recipes from a URL", "Add a shopping list"],
    minutesBetweenCommits: 3 * day,
    latestMinutesAgo: 5 * day,
    checkouts: {
      macbook: {
        branch: {
          name: "feat/meal-planner",
          commits: ["Plan meals for the week", "Drag recipes onto days"],
          unpushed: 1,
          minutesAgo: 26 * hour,
        },
        changes: [".M src/planner/Week.tsx", "?? src/planner/drag.ts", "?? src/planner/Day.tsx"],
        fetchedMinutesAgo: 20,
      },
      studio: { fetchedMinutesAgo: 40 },
    },
  },
  {
    key: "blog",
    remote: github("pondhopper/pondhopper.dev"),
    folder: "pondhopper.dev",
    root: "projects",
    defaultBranch: "main",
    project: { title: "Blog", icon: { _tag: "Monogram", text: "PH", color: "pink" } },
    history: [
      "Post: one dashboard for every machine",
      "Add an RSS feed",
      "Post: moving my homelab to Proxmox",
    ],
    minutesBetweenCommits: 9 * day,
    latestMinutesAgo: 3 * day,
    pullRequests: [
      {
        number: 12,
        title: "Post: one dashboard for every machine",
        branch: "post/fleet-dashboard",
        merged: true,
      },
    ],
    checkouts: {
      macbook: {
        branch: {
          name: "post/fleet-dashboard",
          commits: ["Post: one dashboard for every machine"],
          upstream: "Gone",
          merged: true,
          minutesAgo: 3 * day,
        },
        fetchedMinutesAgo: 20,
      },
      studio: { fetchedMinutesAgo: 40 },
    },
  },
  {
    key: "nvim-config",
    remote: { _tag: "Remote", host: "codeberg.org", path: "pondhopper/nvim-config" },
    folder: "nvim-config",
    root: "projects",
    defaultBranch: "main",
    project: null,
    history: ["Switch to blink.cmp", "Map <leader>gs to lazygit", "Format on save with conform"],
    minutesBetweenCommits: 6 * day,
    latestMinutesAgo: 4 * day,
    checkouts: {
      macbook: { fetchedMinutesAgo: 20 },
      workstation: { fetchedMinutesAgo: 70 },
      devbox: { fetchedMinutesAgo: 30 },
    },
  },
  {
    key: "advent-of-code",
    remote: github("pondhopper/advent-of-code"),
    folder: "advent-of-code",
    root: "projects",
    defaultBranch: "main",
    project: null,
    history: ["Day 12 part 2", "Day 12 part 1", "Day 11", "Day 10 with a flood fill"],
    minutesBetweenCommits: day,
    latestMinutesAgo: 300 * day,
    checkouts: {
      workstation: {
        unpushed: ["Day 13 part 1", "Faster grid parsing", "Day 12 cleanup"],
        changes: [
          ".M 2025/day13/main.go",
          "?? 2025/day13/input.txt",
          "?? 2025/day14/main.go",
          "?? 2025/day14/input.txt",
        ],
        fetchedMinutesAgo: 70,
      },
    },
  },
  {
    key: "scratch",
    remote: { _tag: "Local", rootCommit: "4f1c2a9be03d7e6158a2c4d90f7b3e61a8c5d214" },
    folder: "scratch",
    root: "projects",
    defaultBranch: "main",
    project: null,
    history: ["Try the new Temporal API", "Benchmark JSON parsers", "Sketch a CRDT counter"],
    minutesBetweenCommits: 9 * day,
    latestMinutesAgo: 6 * day,
    checkouts: {
      macbook: {
        changes: [
          ".M temporal/zones.ts",
          "?? temporal/calendars.ts",
          "?? notes.md",
          "?? sqlite/wal.ts",
          "?? sqlite/bench.ts",
          "?? crdt/register.ts",
        ],
      },
    },
  },
  {
    key: "portfolio",
    remote: github("pondhopper/portfolio-2022"),
    folder: "portfolio-2022",
    root: "projects",
    defaultBranch: "main",
    project: null,
    history: ["Add case studies", "Dark mode", "First version"],
    minutesBetweenCommits: 20 * day,
    latestMinutesAgo: 700 * day,
    checkouts: {
      macbook: { archivedDaysAgo: 40, fetchedMinutesAgo: 41 * day },
    },
  },
  {
    key: "lilypad-admin",
    remote: github("lilypad-hq/legacy-admin"),
    folder: "legacy-admin",
    root: "work",
    defaultBranch: "master",
    project: null,
    history: ["Remove the reports page", "Upgrade to Rails 7.1", "Add audit log"],
    minutesBetweenCommits: 30 * day,
    latestMinutesAgo: 200 * day,
    checkouts: {
      studio: { archivedDaysAgo: 75, fetchedMinutesAgo: 80 * day },
    },
  },
];

export const demoLayout: DemoLayout = {
  pinned: ["fleetfrog", "lilypad-api"],
  groups: [
    {
      id: "6f9a3c1e-2b7d-4e8a-9c5f-1d2e3f4a5b6c",
      name: "Lilypad",
      repositories: [
        "lilypad-web",
        "lilypad-mobile",
        "design-system",
        "ops-runbooks",
        "terraform-modules",
      ],
    },
    {
      id: "0c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      name: "Open source",
      repositories: [
        "astro",
        "bun",
        "effect",
        "excalidraw",
        "oxc",
        "t3code",
        "tailwindcss",
        "tanstack-router",
        "vite",
      ],
    },
    {
      id: "3d2c1b0a-9f8e-4d7c-b6a5-4e3d2c1b0a9f",
      name: "Homelab",
      repositories: ["homelab", "home-assistant", "immich"],
    },
  ],
};
