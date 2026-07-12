#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDoc, getSample, listSamples, searchDocs } from "./knowledge.js";
import {
  createOpMode,
  createProject,
  installPedro,
  listOpModes,
} from "./project.js";
import {
  adbConnect,
  adbDevices,
  buildProject,
  deploy,
  robotLogs,
} from "./robot.js";
import { TEMPLATE_DESCRIPTIONS, TEMPLATE_IDS } from "./templates.js";
import {
  createCalculation,
  createSubsystem,
  documentSubsystem,
  getSubsystem,
  hardwareManifest,
  listSubsystems,
} from "./subsystems.js";
import { createTeleOp } from "./teleop.js";
import { ToolError } from "./paths.js";

const server = new McpServer({ name: "ftc-mcp", version: "0.1.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function text(s: string): ToolResult {
  return { content: [{ type: "text", text: s }] };
}

/** Uniform error handling: ToolError -> isError result the model can act on. */
function guard<A extends unknown[]>(
  fn: (...args: A) => string | Promise<string>
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      return text(await fn(...args));
    } catch (err) {
      if (err instanceof ToolError) {
        return { ...text(err.message), isError: true };
      }
      throw err;
    }
  };
}

const projectPathArg = z
  .string()
  .optional()
  .describe(
    "Path to the FtcRobotController SDK project. Defaults to $FTC_PROJECT_DIR, then the workspace clone made by create_project."
  );

// ---------- Knowledge ----------

server.registerTool(
  "list_samples",
  {
    title: "List FTC sample OpModes",
    description:
      "List the official FtcRobotController sample OpModes (drive code, sensors, AprilTag vision, gamepad, telemetry...). " +
      "Start here to find working reference code for any FTC hardware or SDK feature.",
    inputSchema: {
      category: z
        .enum(["Basic", "Concept", "Robot", "Sensor", "Sample", "Utility"])
        .optional()
        .describe("Filter by sample category"),
    },
  },
  guard(async ({ category }: { category?: string }) => {
    const samples = listSamples(category);
    return samples
      .map(
        (s) =>
          `${s.name} [${s.category}${s.opModeType !== "none" ? `, ${s.opModeType}` : ""}]\n  ${s.summary}`
      )
      .join("\n");
  })
);

server.registerTool(
  "get_sample",
  {
    title: "Get FTC sample OpMode source",
    description:
      "Return the full Java source of an official FTC sample OpMode by name (from list_samples).",
    inputSchema: { name: z.string().describe("Sample name, e.g. BasicOmniOpMode_Linear") },
  },
  guard(async ({ name }: { name: string }) => getSample(name))
);

server.registerTool(
  "search_docs",
  {
    title: "Search FTC + Pedro Pathing knowledge",
    description:
      "Keyword search across the Pedro Pathing documentation and the official FTC sample OpModes. " +
      "Use for questions about path following, tuning, localization, coordinates, and SDK features.",
    inputSchema: {
      query: z.string().describe("Search terms, e.g. 'pinpoint localizer tuning'"),
      limit: z.number().int().min(1).max(20).optional(),
    },
  },
  guard(async ({ query, limit }: { query: string; limit?: number }) => {
    const hits = searchDocs(query, limit ?? 8);
    if (hits.length === 0) return "No matches. Try different keywords.";
    return hits
      .map(
        (h) =>
          `[${h.source}] ${h.id}${h.title !== h.id ? ` — ${h.title}` : ""}\n  ${h.snippet}\n  (fetch with ${h.source === "pedro-docs" ? "get_doc" : "get_sample"}: "${h.id}")`
      )
      .join("\n\n");
  })
);

server.registerTool(
  "get_doc",
  {
    title: "Get Pedro Pathing doc page",
    description:
      "Return a full Pedro Pathing documentation page as markdown, by id from search_docs (e.g. 'pathing/examples/auto').",
    inputSchema: { id: z.string().describe("Doc id, e.g. pathing/tuning/localization/pinpoint") },
  },
  guard(async ({ id }: { id: string }) => {
    const doc = getDoc(id);
    return `# ${doc.title}\n\n${doc.text}`;
  })
);

// ---------- Project ----------

server.registerTool(
  "create_project",
  {
    title: "Create FTC SDK project",
    description:
      "Clone a fresh FtcRobotController SDK project (the standard FTC season starting point) into the workspace. " +
      "Skip this if the team already has a project — pass its path to the other tools instead.",
    inputSchema: {
      dest: z.string().optional().describe("Destination directory (default: workspace/FtcRobotController)"),
    },
  },
  guard(async ({ dest }: { dest?: string }) => createProject(dest))
);

server.registerTool(
  "list_opmodes",
  {
    title: "List team OpModes",
    description: "List all @TeleOp/@Autonomous OpModes in the project's TeamCode module.",
    inputSchema: { projectPath: projectPathArg },
  },
  guard(async ({ projectPath }: { projectPath?: string }) => {
    const opmodes = listOpModes(projectPath);
    if (opmodes.length === 0) return "No OpModes in TeamCode yet. Use create_opmode to scaffold one.";
    return opmodes
      .map(
        (o) =>
          `${o.className} [${o.type}${o.disabled ? ", DISABLED" : ""}] name="${o.name}" — ${o.file}`
      )
      .join("\n");
  })
);

server.registerTool(
  "create_opmode",
  {
    title: "Create OpMode from template",
    description:
      "Scaffold a new Java OpMode in TeamCode. Templates:\n" +
      TEMPLATE_IDS.map((t) => `- ${t}: ${TEMPLATE_DESCRIPTIONS[t]}`).join("\n"),
    inputSchema: {
      projectPath: projectPathArg,
      className: z.string().describe("Java class name, e.g. BlueLeftAuto"),
      template: z.enum(TEMPLATE_IDS),
      opModeName: z.string().optional().describe("Display name on the Driver Station (default: class name)"),
      group: z.string().optional().describe("OpMode group on the Driver Station (default: Generated)"),
      packageName: z.string().optional().describe("Java package (default: org.firstinspires.ftc.teamcode)"),
      overwrite: z.boolean().optional(),
    },
  },
  guard(async (args: Parameters<typeof createOpMode>[0]) => createOpMode(args))
);

server.registerTool(
  "install_pedro",
  {
    title: "Install Pedro Pathing",
    description:
      "Install the Pedro Pathing library into an FTC SDK project: adds the Gradle maven repo + dependencies, " +
      "raises compileSdk to 34, and scaffolds pedroPathing/Constants.java (mecanum + Pinpoint by default). " +
      "The constants MUST be tuned afterwards — see search_docs 'tuning'.",
    inputSchema: {
      projectPath: projectPathArg,
      version: z.string().optional().describe("Pedro version (default: latest release from GitHub)"),
    },
  },
  guard(async ({ projectPath, version }: { projectPath?: string; version?: string }) =>
    installPedro(projectPath, version)
  )
);

// ---------- Subsystems (robot architecture layer) ----------

const deviceSchema = z.object({
  name: z.string().describe("camelCase Java field name, e.g. shooterMotor"),
  config: z.string().optional().describe("Driver Station config name (default: snake_case of name)"),
  reversed: z.boolean().optional(),
});
const sensorSchema = z.object({
  name: z.string(),
  config: z.string().optional(),
  type: z.enum(["color", "distance", "touch", "analog", "digital", "imu"]),
});

server.registerTool(
  "create_subsystem",
  {
    title: "Create a subsystem",
    description:
      "Scaffold a plain FTC subsystem class (constructor takes HardwareMap; hardware fields, config-name constants, " +
      "action methods, and a safety stop()). Also writes a bench-test TeleOp and a markdown doc in docs/. " +
      "This is the recommended way to structure robot code — one class per mechanism (intake, spindexer, turret...).",
    inputSchema: {
      projectPath: projectPathArg,
      name: z.string().describe("Subsystem class name, e.g. RollingIntake"),
      group: z
        .string()
        .optional()
        .describe("Lowercase package group / folder, e.g. 'shooting' -> teamcode.shooting (default: subsystems)"),
      description: z.string().optional(),
      motors: z.array(deviceSchema).optional(),
      servos: z.array(deviceSchema).optional(),
      crServos: z.array(deviceSchema).optional(),
      sensors: z.array(sensorSchema).optional(),
      dependencies: z
        .array(
          z.object({
            type: z.string().describe("Class name of another subsystem, e.g. ColorSensor"),
            name: z.string().optional().describe("Field name (default: camelCase of type)"),
          })
        )
        .optional()
        .describe("Other subsystems this one needs, injected into the constructor (must already exist)"),
      constants: z
        .array(
          z.object({
            name: z.string().describe("Constant name, e.g. Kp or INTAKE_POSITION"),
            value: z.string().describe("Java literal/expression, e.g. '0.59' or 'Math.toRadians(180)'"),
            javaType: z.string().optional().describe("Java type (default: double)"),
            comment: z.string().optional(),
            tunable: z
              .boolean()
              .optional()
              .describe("true (default): live-editable dashboard field; false: fixed private static final"),
          })
        )
        .optional()
        .describe("Named constants (PID gains, servo positions, RPM setpoints). Tunable ones are live-editable while the robot runs."),
      dashboard: z
        .enum(["panels", "ftcdashboard", "none"])
        .optional()
        .describe("Live-tuning system for tunable constants (default: panels, matching install_pedro's Panels)"),
      methods: z.array(z.string()).optional().describe("Action method names to stub, e.g. ['spinIn','spitOut']"),
      testOpMode: z.boolean().optional().describe("Also generate a bench-test TeleOp (default true)"),
      overwrite: z.boolean().optional(),
    },
  },
  guard(async (args: Parameters<typeof createSubsystem>[0]) => createSubsystem(args))
);

server.registerTool(
  "document_subsystem",
  {
    title: "Document a subsystem",
    description:
      "Write or update the markdown knowledge-base doc for a subsystem (docs/subsystems/<Name>.md) and refresh " +
      "the docs/ROBOT.md index. Use this to record what each function does, tuning values, config names, and quirks " +
      "as the team describes them — so future sessions understand the robot without reading all the code.",
    inputSchema: {
      projectPath: projectPathArg,
      name: z.string().describe("Subsystem name (matches the class name)"),
      content: z.string().describe("Full markdown body for the subsystem doc"),
    },
  },
  guard(async (args: Parameters<typeof documentSubsystem>[0]) => documentSubsystem(args))
);

server.registerTool(
  "list_subsystems",
  {
    title: "List documented subsystems",
    description:
      "List the robot's subsystems from the docs/ knowledge base. Start here to learn the robot's architecture.",
    inputSchema: { projectPath: projectPathArg },
  },
  guard(async ({ projectPath }: { projectPath?: string }) => listSubsystems(projectPath))
);

server.registerTool(
  "get_subsystem",
  {
    title: "Get subsystem doc",
    description:
      "Return a subsystem's knowledge-base doc (hardware, config names, functions, tuning, quirks), optionally with its Java source.",
    inputSchema: {
      projectPath: projectPathArg,
      name: z.string(),
      includeSource: z.boolean().optional().describe("Append the subsystem's .java source"),
    },
  },
  guard(async (args: Parameters<typeof getSubsystem>[0]) => getSubsystem(args))
);

server.registerTool(
  "create_calculation",
  {
    title: "Create a calculation helper",
    description:
      "Scaffold a stateless static-only helper class (e.g. live trajectory math) that any OpMode or subsystem can call. " +
      "Keeps math out of subsystem/OpMode files.",
    inputSchema: {
      projectPath: projectPathArg,
      name: z.string().describe("Class name, e.g. TrajectorySolver"),
      group: z.string().optional().describe("Package group (default: util)"),
      description: z.string().optional(),
      overwrite: z.boolean().optional(),
    },
  },
  guard(async (args: Parameters<typeof createCalculation>[0]) => createCalculation(args))
);

server.registerTool(
  "hardware_manifest",
  {
    title: "Hardware config manifest",
    description:
      "Scan TeamCode for every robot-configuration name (from hardwareMap.get and subsystem constructors) and list them, " +
      "flagging any name used in multiple files. Use to cross-check code against the Driver Station configuration and catch typos/collisions.",
    inputSchema: { projectPath: projectPathArg },
  },
  guard(async ({ projectPath }: { projectPath?: string }) => hardwareManifest(projectPath))
);

const actionSchema = z.object({
  name: z.string().describe("camelCase action name, e.g. intakeIn"),
  label: z.string().optional().describe("Human description for comments/control map"),
  input: z
    .string()
    .describe("Gamepad expression using `driver` and `operator`, e.g. 'driver.right_bumper' or 'operator.left_trigger > 0.5'"),
  mode: z.enum(["hold", "press", "toggle"]).describe("hold = while held, press = on rising edge, toggle = flip on press"),
  onActive: z.string().optional().describe("Code to run when active, no trailing ';', e.g. 'intake.spinIn()'"),
  onInactive: z.string().optional().describe("Code to run when inactive (hold/toggle), e.g. 'intake.stop()'"),
  exclusiveGroup: z
    .string()
    .optional()
    .describe(
      "Group name for mutually-exclusive hold actions on one mechanism (e.g. intake in/out). Members become one if/else-if/else chain with a shared idle, so they can't override each other."
    ),
  guard: z
    .string()
    .optional()
    .describe("Robot-state condition ANDed with the input so the action only fires when safe/efficient, e.g. '!spindexer.isBusy()'"),
});
const automationSchema = z.object({
  name: z.string().describe("camelCase; becomes a stub method + call site"),
  description: z.string().describe("What this automation should do (drives the generated Javadoc/TODO)"),
  input: z.string().optional().describe("Optional gating input; omit for a behavior that runs every loop (e.g. sensor-driven)"),
  guard: z.string().optional().describe("Robot-state condition ANDed with the trigger, e.g. '!outtakeInProgress'"),
});
const slowModeSchema = z.object({
  input: z.string().describe("Gamepad expression, e.g. 'driver.left_trigger > 0.5'"),
  mode: z.enum(["hold", "toggle"]),
  factor: z.number().describe("Drive multiplier when active, e.g. 0.4"),
});

server.registerTool(
  "create_teleop",
  {
    title: "Create a TeleOp with a separate bindings file",
    description:
      "Generate a TeleOp OpMode PLUS a separate <Name>Controls.java that holds only the controller bindings, so a " +
      "driver can remap buttons without touching robot logic or an LLM. Describe the drivetrain, which subsystems to " +
      "use, button actions (hold/press/toggle → subsystem calls), an optional slow mode, and named automations " +
      "(multi-step or sensor-driven behaviors, which are scaffolded as stub methods to fill in).",
    inputSchema: {
      projectPath: projectPathArg,
      className: z.string().describe("TeleOp class name, e.g. CompTeleOp"),
      opModeName: z.string().optional().describe("Driver Station display name (default: class name)"),
      group: z.string().optional().describe("OpMode group / package group (default: Competition)"),
      packageName: z.string().optional(),
      drive: z
        .enum(["mecanum", "mecanum-field-centric", "pedro", "pedro-field-centric", "none"])
        .optional()
        .describe("Drivetrain wiring (default: mecanum). pedro* requires install_pedro."),
      subsystems: z.array(z.string()).optional().describe("Subsystem class names to construct (must already exist)"),
      actions: z.array(actionSchema).optional(),
      automations: z.array(automationSchema).optional(),
      slowMode: slowModeSchema.optional(),
      overwrite: z.boolean().optional(),
    },
  },
  guard(async (args: Parameters<typeof createTeleOp>[0]) => createTeleOp(args))
);

// ---------- Robot ----------

server.registerTool(
  "adb_devices",
  {
    title: "List connected robot devices",
    description: "List Android devices visible to adb (Control Hub / Robot Controller phone).",
    inputSchema: {},
  },
  guard(async () => adbDevices())
);

server.registerTool(
  "adb_connect",
  {
    title: "Connect to robot over WiFi",
    description:
      "Connect adb to a REV Control Hub or RC phone over WiFi. Default target is 192.168.43.1:5555 " +
      "(the Control Hub when the laptop is joined to the robot's WiFi network).",
    inputSchema: {
      host: z.string().optional().describe("Device IP (default 192.168.43.1)"),
      port: z.number().int().optional().describe("Port (default 5555)"),
    },
  },
  guard(async ({ host, port }: { host?: string; port?: number }) => adbConnect(host, port ?? 5555))
);

server.registerTool(
  "build",
  {
    title: "Build robot code",
    description:
      "Compile the TeamCode module with Gradle (assembleDebug). Returns the APK path on success, " +
      "or the extracted compiler errors on failure. First build can take several minutes.",
    inputSchema: { projectPath: projectPathArg },
  },
  guard(async ({ projectPath }: { projectPath?: string }) => buildProject(projectPath))
);

server.registerTool(
  "deploy",
  {
    title: "Deploy code to robot",
    description:
      "Install the built TeamCode APK on the connected robot (adb install) and restart the Robot Controller app. " +
      "Run build first, and adb_connect/adb_devices to make sure a device is attached.",
    inputSchema: {
      projectPath: projectPathArg,
      serial: z.string().optional().describe("adb device serial if multiple devices are connected"),
    },
  },
  guard(async ({ projectPath, serial }: { projectPath?: string; serial?: string }) =>
    deploy(projectPath, serial)
  )
);

server.registerTool(
  "robot_logs",
  {
    title: "Read robot logs",
    description:
      "Dump recent logcat from the robot. Use after deploying or when an OpMode crashes/misbehaves. " +
      "Useful filters: 'RobotCore' (SDK events), your OpMode class name, 'Exception'.",
    inputSchema: {
      serial: z.string().optional(),
      lines: z.number().int().min(10).max(2000).optional().describe("How many recent lines (default 300)"),
      filter: z.string().optional().describe("Only lines containing this substring (case-insensitive)"),
      errorsOnly: z.boolean().optional().describe("Only error-level log entries"),
    },
  },
  guard(async (args: { serial?: string; lines?: number; filter?: string; errorsOnly?: boolean }) =>
    robotLogs(args)
  )
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("ftc-mcp server running on stdio");
