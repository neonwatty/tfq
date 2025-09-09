import chalk from 'chalk';
import { TfqConfig } from '../core/types.js';
import { InitService, InitOptions } from '../core/init-service.js';
import readline from 'readline';

export async function interactiveInit(
  service: InitService,
  options: InitOptions
): Promise<TfqConfig> {
  console.log(chalk.bold('🚀 TFQ Interactive Setup\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string, defaultValue?: string): Promise<string> => {
    const fullPrompt = defaultValue 
      ? `${prompt} ${chalk.gray(`(${defaultValue})`)}: `
      : `${prompt}: `;
    
    return new Promise((resolve) => {
      rl.question(fullPrompt, (answer) => {
        resolve(answer.trim() || defaultValue || '');
      });
    });
  };

  const confirm = async (prompt: string, defaultYes: boolean = true): Promise<boolean> => {
    const hint = defaultYes ? '(Y/n)' : '(y/N)';
    const answer = await question(`${prompt} ${chalk.gray(hint)}`, defaultYes ? 'y' : 'n');
    return answer.toLowerCase() === 'y' || (defaultYes && answer === '');
  };

  try {
    // Detect project information
    const projectPath = options.scope || process.cwd();
    console.log(`Analyzing project at: ${chalk.cyan(projectPath)}\n`);

    const detectedLanguage = service.detectProjectType(projectPath);
    const detectedFramework = detectedLanguage 
      ? service.detectFramework(detectedLanguage, projectPath) 
      : null;

    if (detectedLanguage) {
      console.log(chalk.green('✓'), 'Detected language:', chalk.yellow(detectedLanguage));
    }
    if (detectedFramework) {
      console.log(chalk.green('✓'), 'Detected framework:', chalk.yellow(detectedFramework));
    }
    console.log();

    // Database path
    const defaultDbPath = options.ci ? '/tmp/tfq-tfq.db' : './.tfq/tfq.db';
    const dbPath = await question(
      'Where should the test queue database be stored?',
      options.dbPath || defaultDbPath
    );

    // Auto-detect confirmation
    const useAutoDetect = await confirm(
      'Auto-detect language and framework for test execution?',
      true
    );

    let language = detectedLanguage;
    let framework = detectedFramework;

    if (!useAutoDetect) {
      // Manual language selection
      const languageInput = await question(
        'Enter language (javascript/python/ruby/go/java)',
        detectedLanguage || 'javascript'
      );
      language = languageInput as any;

      // Manual framework selection
      if (language) {
        const frameworkInput = await question(
          `Enter framework for ${language}`,
          detectedFramework || ''
        );
        framework = frameworkInput || null;
      }
    }

    // Parallel test processes
    const parallelStr = await question(
      'Default number of parallel test processes?',
      '4'
    );
    const parallel = parseInt(parallelStr, 10) || 4;

    // Auto-add failed tests
    const autoAdd = await confirm(
      'Automatically add failed tests after test runs?',
      true
    );

    // Workspace configuration for monorepos
    let workspaces: Record<string, string> | undefined;
    if (!options.ci && await confirm('Is this a monorepo with workspaces?', false)) {
      console.log('\n' + chalk.yellow('Workspace configuration:'));
      console.log(chalk.gray('Enter workspace paths (e.g., packages/app) one per line.'));
      console.log(chalk.gray('Press Enter with empty line when done.\n'));

      workspaces = {};
      let workspacePath = await question('Workspace path');
      while (workspacePath) {
        const wsName = workspacePath.split('/').pop() || workspacePath;
        workspaces[workspacePath] = `./.tfq/${wsName}-tfq.db`;
        console.log(chalk.gray(`  Added: ${workspacePath} → ./.tfq/${wsName}-tfq.db`));
        workspacePath = await question('Workspace path');
      }
    }

    // Claude integration setup
    console.log('\n' + chalk.bold('🤖 Claude Code Integration'));
    console.log(chalk.gray('Claude Code can automatically fix failing tests for you.\n'));

    const enableClaude = await confirm(
      'Enable Claude Code integration for automated test fixing?',
      false  // Default to false to be safe
    );

    let claudeConfig = undefined;
    if (enableClaude) {
      try {
        // Detect Claude availability
        const { ClaudeConfigManager } = await import('../services/claude/config.js');
        const claudeManager = new ClaudeConfigManager();
        const detectedPath = claudeManager.detectClaudePath();
        
        if (detectedPath) {
          console.log(chalk.green('✓'), 'Found Claude at:', chalk.cyan(detectedPath));
        } else {
          console.log(chalk.yellow('⚠️'), 'Claude Code CLI not found at standard locations');
          console.log(chalk.gray('You can install it from: https://claude.ai/code'));
        }
        
        const claudePath = await question(
          'Claude executable path (leave empty for auto-detection)',
          detectedPath || ''
        );
        
        const maxIterations = parseInt(await question(
          'Max iterations for fix-all command',
          '10'
        ), 10) || 10;
        
        const testTimeout = parseInt(await question(
          'Timeout per test fix (milliseconds)',
          '900000'
        ), 10) || 900000;
        
        claudeConfig = {
          enabled: true,
          maxIterations,
          testTimeout,
          prompt: "Fix the syntax and logic errors in this test file and return only the corrected code",
          // Enable verbose output by default to show Claude's real-time progress
          verbose: true,
          outputFormat: "stream-json" as const,
          ...(claudePath && { claudePath })
        };
        
        console.log(chalk.green('✓'), 'Claude integration configured');
      } catch (error) {
        console.log(chalk.red('❌'), 'Failed to configure Claude integration:', (error as Error).message);
        console.log(chalk.gray('Continuing without Claude integration...'));
      }
    }

    // Build configuration
    const config: TfqConfig = {
      database: { path: dbPath },
      defaults: { autoAdd, parallel }
    };

    if (language) {
      config.language = language;
    }

    if (framework) {
      config.framework = framework;
    }

    if (workspaces && Object.keys(workspaces).length > 0) {
      config.workspaces = workspaces;
      config.workspaceDefaults = { autoAdd, parallel };
    }

    if (claudeConfig) {
      config.claude = claudeConfig;
    }

    // Preview configuration
    console.log('\n' + chalk.bold('Configuration Preview:'));
    console.log(JSON.stringify(config, null, 2));
    console.log();

    const proceed = await confirm('Save this configuration?', true);
    if (!proceed) {
      throw new Error('Configuration cancelled by user');
    }

    rl.close();

    // Initialize with the configured options
    const initOptions: InitOptions = {
      ...options,
      dbPath: config.database?.path,
      workspaceMode: !!config.workspaces
    };

    // Create database directory and handle gitignore
    await service.initialize(initOptions);

    return config;
  } catch (error) {
    rl.close();
    throw error;
  }
}