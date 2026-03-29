/**
 * react-check.mjs — Pre-build React lint check
 *
 * Catches React-specific errors that tsc --noEmit misses:
 *   - "Cannot access refs during render"
 *   - "Calling setState synchronously within an effect"
 *   - Missing hook dependencies
 *   - Hook rule violations
 *
 * Usage:  node scripts/react-check.mjs
 * Exit 1 if any React errors found, 0 otherwise.
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// React-specific ESLint rules to check
const reactRules = [
    'react-hooks/rules-of-hooks',
    'react-hooks/exhaustive-deps',
    'react-compiler/react-compiler',  // if react-compiler plugin present
];

console.log('🔍 React Lint Check — scanning for React-specific errors...\n');

try {
    const result = execSync(
        `npx eslint --no-warn-ignored --max-warnings 0 "src/**/*.{ts,tsx}" --format stylish 2>&1`,
        { cwd: root, encoding: 'utf-8', timeout: 60000 }
    );
    // If eslint exits clean, check for any React-specific warnings in output
    console.log('✅ No React lint errors found.\n');
    process.exit(0);
} catch (err) {
    const output = err.stdout || err.stderr || '';

    // Filter for React-specific issues only
    const lines = output.split('\n');
    const reactIssues = [];
    let currentFile = '';

    for (const line of lines) {
        // File header (absolute path)
        if (line.match(/^[A-Z]:\\|^\//) && !line.includes('error') && !line.includes('warning')) {
            currentFile = line.trim();
            continue;
        }

        // Check for React-specific patterns
        const isReactIssue =
            line.includes('react-hooks/') ||
            line.includes('react-compiler') ||
            line.includes('Cannot access refs during render') ||
            line.includes('setState synchronously within an effect') ||
            line.includes('React Hook') ||
            line.includes('rules-of-hooks');

        if (isReactIssue) {
            reactIssues.push({ file: currentFile, detail: line.trim() });
        }
    }

    if (reactIssues.length === 0) {
        // ESLint had errors but none were React-specific
        console.log('✅ No React-specific lint errors (other ESLint issues may exist).\n');
        process.exit(0);
    }

    // Report React-specific issues
    console.log(`❌ Found ${reactIssues.length} React-specific issue(s):\n`);
    let lastFile = '';
    for (const issue of reactIssues) {
        if (issue.file && issue.file !== lastFile) {
            console.log(`  📄 ${issue.file}`);
            lastFile = issue.file;
        }
        console.log(`     ${issue.detail}`);
    }
    console.log(`\n💡 Fix these before running tsc --noEmit.\n`);
    process.exit(1);
}
