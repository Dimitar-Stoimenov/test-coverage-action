import { setFailed, getInput, setOutput } from "@actions/core";
import * as fs from "fs";

interface CoverageInterface {
	"total": number;
	"covered": number;
	"skipped": number;
	"pct": number;
}

interface SingleFileInterface {
	"lines": CoverageInterface;
	"functions": CoverageInterface;
	"statements": CoverageInterface;
	"branches": CoverageInterface;
}

interface JSONInterface {
	[x: string]: SingleFileInterface;
}

interface CompareResult {
	statementsPct: number;
	branchesPct: number;
}

interface FileIssue {
	fileName: string;
	message: string;
}

function parseExcludePatterns(input: string): RegExp[] {
	if (!input || input === "") return [];

	const patterns: RegExp[] = [];
	const patternStrings = input.split(",").map((pattern) => pattern.trim());

	for (const patternString of patternStrings) {
		try {
			patterns.push(new RegExp(patternString));
		} catch (error) {
			console.warn(`Invalid regex pattern "${patternString}", skipping: ${(error as Error).message}`);
		}
	}

	return patterns;
}

function run() {
	const generalCoverageTolerance = +getInput("generalCoverageTolerance") || 0.03;
	const singleLineCoverageTolerance = +getInput("singleLineCoverageTolerance") || 5;
	const newFileCoverageThreshold = +getInput("newFileCoverageThreshold") || 40;
	const ignoredPathsInput = getInput("ignoredPaths");
	const ignoredPaths = (!ignoredPathsInput || ignoredPathsInput === "")
		? []
		: ignoredPathsInput.split(",").map((pathString) => pathString.trim());
	const excludePatterns = parseExcludePatterns(getInput("excludeFilePatterns"));

	console.log(`General coverage tolerance: ${generalCoverageTolerance.toFixed(2)}%`);
	console.log(`Single file coverage tolerance: ${singleLineCoverageTolerance.toFixed(2)}%`);
	console.log(`New file coverage threshold: ${newFileCoverageThreshold.toFixed(2)}%`);
	ignoredPaths.forEach((path) => {
		console.log(`Ignoring files in ${path}`);
	});
	excludePatterns.forEach((pattern) => {
		console.log(`Excluding files matching pattern: ${pattern}`);
	});
	console.log("");

	const basePath = "./coverage-base/coverage-summary.json";
	const prPath = "./coverage-pr/coverage-summary.json";

	const isFileExcluded = (fileName: string): boolean => {
		// Check ignored paths
		if (ignoredPaths.length && ignoredPaths.some((folder) => fileName.includes(folder))) {
			return true;
		}

		// Check excluded file patterns (match against file name only, not full path)
		const fileNameOnly = fileName.split("/").pop() || "";
		if (excludePatterns.length && excludePatterns.some((pattern) => pattern.test(fileNameOnly))) {
			return true;
		}

		return false;
	};

	const compareFileCoverage = (
		prFileObj: SingleFileInterface,
		baseFileObj: SingleFileInterface | undefined,
		fileName: string
	): { result: CompareResult | null; issue: FileIssue | null } => {
		if (isFileExcluded(fileName)) {
			return { result: null, issue: null };
		}

		// Handle new or renamed files
		if (!baseFileObj) {
			const prBranchPct = prFileObj.branches?.pct ?? 0;
			const prStatementsPct = prFileObj.statements?.pct ?? 0;

			if (prBranchPct < newFileCoverageThreshold || prStatementsPct < newFileCoverageThreshold) {
				return {
					result: null,
					issue: {
						fileName,
						message: `new or renamed file that does not meet the test coverage threshold of ${newFileCoverageThreshold}%! >>> Statements: ${prStatementsPct.toFixed(2)}%, Branches: ${prBranchPct.toFixed(2)}%`
					}
				};
			}

			return { result: null, issue: null };
		}

		let diffCheck = false;
		const result: CompareResult = {
			statementsPct: 0,
			branchesPct: 0
		};

		const prStatementsPct = prFileObj.statements?.pct ?? 0;
		const baseStatementsPct = baseFileObj.statements?.pct ?? 0;
		const prBranchesPct = prFileObj.branches?.pct ?? 0;
		const baseBranchesPct = baseFileObj.branches?.pct ?? 0;

		if (prStatementsPct < baseStatementsPct) {
			if ((prStatementsPct + singleLineCoverageTolerance) < baseStatementsPct) {
				diffCheck = true;
			}
			result.statementsPct = prStatementsPct - baseStatementsPct;
		}

		if (prBranchesPct < baseBranchesPct) {
			if ((prBranchesPct + singleLineCoverageTolerance) < baseBranchesPct) {
				diffCheck = true;
			}
			result.branchesPct = prBranchesPct - baseBranchesPct;
		}

		if (!diffCheck) {
			return { result: null, issue: null };
		}

		const statementsMsg = result.statementsPct < 0 ? `Statements Diff: ${result.statementsPct.toFixed(2)}%` : "";
		const branchesMsg = result.branchesPct < 0 ? `Branches Diff: ${result.branchesPct.toFixed(2)}%` : "";
		const message = [statementsMsg, branchesMsg].filter(Boolean).join(" | ");

		return {
			result,
			issue: { fileName, message }
		};
	};

	try {
		// Check if files exist
		if (!fs.existsSync(basePath)) {
			throw new Error(`Base coverage file not found: ${basePath}`);
		}
		if (!fs.existsSync(prPath)) {
			throw new Error(`PR coverage file not found: ${prPath}`);
		}

		const baseResultJSON = fs.readFileSync(basePath, "utf8");
		const prResultJSON = fs.readFileSync(prPath, "utf8");

		const baseResultObject: JSONInterface = JSON.parse(baseResultJSON);
		const prResultObject: JSONInterface = JSON.parse(prResultJSON);

		const baseResultTotal = baseResultObject.total;
		const prResultTotal = prResultObject.total;

		if (!baseResultTotal || !prResultTotal) {
			throw new Error("Coverage files are missing 'total' property");
		}

		const statementsDiff = prResultTotal.statements.pct - baseResultTotal.statements.pct;
		const branchesDiff = prResultTotal.branches.pct - baseResultTotal.branches.pct;

		let generalDiffMessage = "";

		if (statementsDiff < -generalCoverageTolerance || branchesDiff < -generalCoverageTolerance) {
			generalDiffMessage = "⚠️ The general coverage is worse than before and above the tolerance. You need to write more tests!";
		}

		const issues: FileIssue[] = [];

		for (const fileName of Object.keys(prResultObject)) {
			// Skip the "total" key explicitly
			if (fileName === "total") continue;

			const prFileCoverageObj = prResultObject[fileName];
			const baseFileCoverageObj = baseResultObject[fileName];

			const { issue } = compareFileCoverage(prFileCoverageObj, baseFileCoverageObj, fileName);
			if (issue) {
				issues.push(issue);
			}
		}

		console.log("============================== Coverage difference =============================");
		console.log(`Statements   : ${statementsDiff > 0 ? "+" + statementsDiff.toFixed(2) : statementsDiff.toFixed(2)}%`);
		console.log(`Branches     : ${branchesDiff > 0 ? "+" + branchesDiff.toFixed(2) : branchesDiff.toFixed(2)}%`);
		console.log("================================================================================");
		console.log("");

		if (issues.length > 0) {
			console.log("=========================== Files with worse coverage ==========================");
			for (const issue of issues) {
				console.log(`${issue.fileName} >>> ${issue.message}`);
			}
			console.log("================================================================================");
			console.log("");
		}

		// Build the PR comment report
		const hasIssues = issues.length > 0 || generalDiffMessage !== "";
		let coverageReport = "";

		if (hasIssues) {
			coverageReport = "## ⚠️ Coverage Report\n\n";
			coverageReport += "### Coverage Difference\n";
			coverageReport += "| Metric | Diff |\n|--------|------|\n";
			coverageReport += `| Statements | ${statementsDiff > 0 ? "+" : ""}${statementsDiff.toFixed(2)}% |\n`;
			coverageReport += `| Branches | ${branchesDiff > 0 ? "+" : ""}${branchesDiff.toFixed(2)}% |\n\n`;

			if (generalDiffMessage) {
				coverageReport += `${generalDiffMessage}\n\n`;
			}

			if (issues.length > 0) {
				coverageReport += "### Files with Coverage Issues\n\n";
				for (const issue of issues) {
					coverageReport += `- \`${issue.fileName}\` - ${issue.message}\n`;
				}
			}
		}

		// Set outputs instead of failing
		setOutput("hasIssues", hasIssues.toString());
		setOutput("coverageReport", coverageReport);

		if (hasIssues) {
			console.log("⚠️ Coverage issues detected - will be posted as PR comment");
		} else {
			console.log("✅ Coverage is OK.");
		}

	} catch (error) {
		setFailed((error as Error)?.message ?? "Unknown error.");
	}
}

run();
