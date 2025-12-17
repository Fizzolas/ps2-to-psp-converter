import path from "path";
import os from "os";
import fs from "fs-extra";
import axios from "axios";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import dotenv from "dotenv";

dotenv.config();

interface PerplexityResponse {
  id: string;
  model: string;
  created: number;
  // The exact response shape may differ; keep this loose and handle safely.
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface PipelineConfig {
  ps2Folder: string;
  outputFolder: string;
  apiKey: string;
}

const CRASH_REPORT_NAME = "ps2-to-psp-converter-crash-report.txt";

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option("ps2-folder", {
      type: "string",
      demandOption: true,
      describe: "Path to extracted PS2 game folder",
    })
    .option("output", {
      type: "string",
      default: "output",
      describe: "Output folder where PSP project will be generated",
    })
    .option("api-key", {
      type: "string",
      describe: "Perplexity API key (overrides PERPLEXITY_API_KEY env var)",
    })
    .strict()
    .parse();

  const config: PipelineConfig = {
    ps2Folder: path.resolve(argv["ps2-folder"] as string),
    outputFolder: path.resolve(argv.output as string),
    apiKey: (argv["api-key"] as string) || process.env.PERPLEXITY_API_KEY || "",
  };

  try {
    validateConfig(config);
    await confirmApiConnection(config.apiKey);
    await runPipeline(config);
    console.log("\n✅ Pipeline completed. Check the output folder:", config.outputFolder);
  } catch (err) {
    await handleFatalError(err as Error);
    process.exit(1);
  }
}

function validateConfig(config: PipelineConfig) {
  if (!config.apiKey) {
    throw new Error("Perplexity API key is required. Use --api-key or PERPLEXITY_API_KEY.");
  }

  if (!fs.existsSync(config.ps2Folder) || !fs.statSync(config.ps2Folder).isDirectory()) {
    throw new Error(`PS2 folder does not exist or is not a directory: ${config.ps2Folder}`);
  }
}

async function confirmApiConnection(apiKey: string) {
  console.log("Checking Perplexity API connectivity...");

  try {
    const res = await axios.post<PerplexityResponse>(
      "https://api.perplexity.ai/chat/completions",
      {
        model: "sonar-reasoning-pro",
        messages: [
          {
            role: "user",
            content: "Respond with the single word: READY",
          },
        ],
        max_tokens: 5,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const content = res.data.choices?.[0]?.message?.content?.trim() ?? "";
    if (content.toUpperCase().includes("READY")) {
      console.log("Perplexity API connection OK.");
    } else {
      console.warn("Perplexity API responded but did not confirm READY. Continuing anyway.");
    }
  } catch (err) {
    throw new Error("Failed to reach Perplexity API. Check your key and network connectivity.");
  }
}

async function runPipeline(config: PipelineConfig) {
  console.log("\nStarting PS2 → PSP pipeline...");

  await fs.ensureDir(config.outputFolder);

  // 1. Scan PS2 folder
  console.log("[1/4] Scanning PS2 folder...");
  const scanReport = await scanPs2Folder(config.ps2Folder);

  // 2. Ask Perplexity for conversion strategy
  console.log("[2/4] Querying Perplexity for conversion plan...");
  const plan = await getConversionPlan(config.apiKey, scanReport);

  // 3. Generate PSP project structure
  console.log("[3/4] Generating PSP project skeleton...");
  await generatePspProject(config.outputFolder, plan);

  // 4. Emit human-readable report
  console.log("[4/4] Writing summary report...");
  await fs.writeFile(
    path.join(config.outputFolder, "conversion-summary.txt"),
    plan,
    "utf8"
  );
}

async function scanPs2Folder(root: string): Promise<string> {
  const entries: string[] = [];

  function walk(dir: string) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        const rel = path.relative(root, full);
        entries.push(`${rel} :: ${stat.size} bytes`);
      }
    }
  }

  walk(root);
  const fingerprint = entries.slice(0, 200).join("\n");
  return `PS2 folder: ${root}\nFiles (first 200 entries):\n${fingerprint}`;
}

async function getConversionPlan(apiKey: string, scanReport: string): Promise<string> {
  const prompt = `You are an expert PS2 and PSP low-level game engineer.\n\n` +
    `Given the following scanned folder report from an extracted PS2 game, propose a concrete, step-by-step plan to:\n` +
    `- Infer the likely engine/middleware and file formats.\n` +
    `- Design a PSP-friendly folder and asset structure.\n    - Identify which parts should be reimplemented, demade, or stubbed.\n` +
    `- Suggest how to map controls, memory budgets, and performance constraints to PSP hardware.\n` +
    `Return your answer as a detailed technical design document.\n\n` +
    `--- PS2 SCAN REPORT START ---\n${scanReport}\n--- PS2 SCAN REPORT END ---`;

  const res = await axios.post<PerplexityResponse>(
    "https://api.perplexity.ai/chat/completions",
    {
      model: "sonar-reasoning-pro",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 4000,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  const content = res.data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Perplexity did not return a conversion plan.");
  }

  return content;
}

async function generatePspProject(outputFolder: string, plan: string): Promise<void> {
  const srcDir = path.join(outputFolder, "src");
  const assetsDir = path.join(outputFolder, "assets");

  await fs.ensureDir(srcDir);
  await fs.ensureDir(assetsDir);

  // Skeleton README for the generated PSP project.
  const readme = `# Generated PSP Project (Skeleton)\n\n` +
    `This folder is an *incomplete* PSP-oriented project skeleton generated from a PS2 game scan.\n\n` +
    `The following high-level plan was used when generating this skeleton:\n\n` +
    `--- PLAN START ---\n${plan}\n--- PLAN END ---\n`;

  await fs.writeFile(path.join(outputFolder, "README.psp.md"), readme, "utf8");

  const mainC = `// Stub main file for PSP homebrew project.\n// Integrate with your chosen PSP SDK / toolchain.\n\nint main(int argc, char *argv[]) {\n    // TODO: Implement game loop using the generated design document.\n    return 0;\n}\n`;

  await fs.writeFile(path.join(srcDir, "main.c"), mainC, "utf8");
}

async function handleFatalError(err: Error) {
  const desktopDir = path.join(os.homedir(), "Desktop");
  const reportPath = path.join(desktopDir, CRASH_REPORT_NAME);

  const content = [
    "PS2 → PSP Converter Crash Report",
    `Timestamp: ${new Date().toISOString()}`,
    "",
    `Name: ${err.name}`,
    `Message: ${err.message}`,
    "",
    `Stack:\n${err.stack ?? "<no stack available>"}`,
  ].join("\n");

  try {
    await fs.ensureDir(desktopDir);
    await fs.writeFile(reportPath, content, "utf8");
    console.error("\n❌ A fatal error occurred. A crash report was written to:", reportPath);
  } catch (writeErr) {
    console.error("\n❌ A fatal error occurred and the crash report could not be written.");
    console.error("Original error:", err);
    console.error("Report write error:", writeErr);
  }
}

main().catch(handleFatalError);
