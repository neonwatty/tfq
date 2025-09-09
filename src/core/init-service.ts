import fs from 'fs';
import path from 'path';
import { TfqConfig, TestLanguage, TestFramework } from './types.js';
import { ConfigManager } from './config.js';
import { TestAdapterRegistry } from '../adapters/registry.js';

export interface InitOptions {
  dbPath?: string;
  interactive?: boolean;
  ci?: boolean;
  shared?: boolean;
  noGitignore?: boolean;
  gitignore?: boolean;  // Added for Commander.js --no-gitignore flag
  workspaceMode?: boolean;
  scope?: string;
  withClaude?: boolean;
  skipClaude?: boolean;
  claudePath?: string;
}

export class InitService {
  private registry: TestAdapterRegistry;
  private configManager: ConfigManager;

  constructor() {
    this.registry = TestAdapterRegistry.getInstance();
    this.configManager = new ConfigManager();
  }

  async initialize(options: InitOptions = {}): Promise<TfqConfig> {
    const projectPath = options.scope ? path.resolve(options.scope) : process.cwd();
    
    // Check if .tfqrc already exists
    const existingConfigPath = path.join(projectPath, '.tfqrc');
    if (fs.existsSync(existingConfigPath) && !options.ci) {
      throw new Error('.tfqrc already exists. Remove it first or use --ci flag to overwrite.');
    }

    // Detect project type
    const detectedLanguage = this.detectProjectType(projectPath);
    const detectedFramework = detectedLanguage ? this.detectFramework(detectedLanguage, projectPath) : null;

    // Generate default configuration
    const config = await this.generateDefaultConfig({
      language: detectedLanguage,
      framework: detectedFramework,
      dbPath: options.dbPath,
      ci: options.ci,
      shared: options.shared,
      workspaceMode: options.workspaceMode,
      withClaude: options.withClaude,
      skipClaude: options.skipClaude,
      claudePath: options.claudePath,
      projectPath
    });

    // Create database directory if needed
    if (config.database?.path) {
      this.createDatabaseDirectory(config.database.path, projectPath);
    }

    // Handle .gitignore
    // Note: Commander.js sets options.gitignore = false for --no-gitignore flag
    if (options.gitignore !== false && !options.noGitignore) {
      await this.ensureGitignore(projectPath);
    }

    return config;
  }

  detectProjectType(projectPath: string = process.cwd()): TestLanguage | null {
    return this.registry.detectLanguage(projectPath);
  }

  detectFramework(language: TestLanguage, projectPath: string = process.cwd()): TestFramework | null {
    return this.registry.detectFramework(language, projectPath);
  }

  async generateDefaultConfig(options: {
    language: TestLanguage | null;
    framework: TestFramework | null;
    dbPath?: string;
    ci?: boolean;
    shared?: boolean;
    workspaceMode?: boolean;
    withClaude?: boolean;
    skipClaude?: boolean;
    claudePath?: string;
    projectPath: string;
  }): Promise<TfqConfig> {
    const { language, framework, dbPath, ci, shared, workspaceMode, withClaude, skipClaude, claudePath, projectPath } = options;

    const config: TfqConfig = {
      database: {
        path: dbPath || (ci ? '/tmp/tfq-tfq.db' : './.tfq/tfq.db')
      },
      defaults: {
        autoAdd: true,
        parallel: 4
      }
    };

    if (language) {
      config.language = language;
    }

    if (framework) {
      config.framework = framework;
    }

    if (workspaceMode) {
      // Detect workspaces and add configuration
      const workspaces = this.detectWorkspaces(projectPath);
      if (workspaces.length > 0) {
        config.workspaces = {};
        for (const workspace of workspaces) {
          const wsName = path.basename(workspace);
          config.workspaces[workspace] = `./.tfq/${wsName}-tfq.db`;
        }
        config.workspaceDefaults = {
          autoAdd: true,
          parallel: 4
        };
      }
    }

    if (shared) {
      // For shared configs, use a non-gitignored path
      config.database!.path = './.tfq/shared-tfq.db';
    }

    // Claude configuration
    if (!skipClaude) {
      try {
        const { ClaudeConfigManager } = await import('../services/claude/config.js');
        const claudeManager = new ClaudeConfigManager();
        const detectedPath = claudeManager.detectClaudePath();
        
        // Enable Claude if explicitly requested OR if Claude is detected and not explicitly disabled
        if (withClaude === true || (detectedPath && !skipClaude)) {
          config.claude = {
            enabled: true,
            maxIterations: 10,
            testTimeout: 900000,
            prompt: "Run the test file at {testFilePath} and debug any errors you encounter one at a time. Then run the test again to verify that your changes have fixed any errors.",
            _comment: "The {testFilePath} placeholder will be replaced with the actual test file path when Claude is invoked",
            // Enable verbose output by default to show Claude's real-time progress
            verbose: true,
            outputFormat: "stream-json",
            // Retry configuration for headless mode resilience
            maxRetries: 3,
            retryDelay: 1000,
            retryBackoffMultiplier: 2,
            maxRetryDelay: 30000
          };
          
          // Set Claude path if provided or detected
          if (claudePath) {
            config.claude.claudePath = claudePath;
          } else if (detectedPath) {
            config.claude.claudePath = detectedPath;
          }
        }
      } catch (error) {
        // Silently ignore Claude service import errors
        // This ensures the init process doesn't fail if Claude service has issues
      }
    }

    return config;
  }

  private createDatabaseDirectory(dbPath: string, projectPath: string): void {
    // Resolve the database path relative to project
    const fullPath = path.isAbsolute(dbPath) 
      ? dbPath 
      : path.join(projectPath, dbPath);
    
    const dbDir = path.dirname(fullPath);
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  async ensureGitignore(projectPath: string): Promise<void> {
    // Check if this is a git repository
    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) {
      // Not a git repo, skip gitignore modification
      return;
    }

    const gitignorePath = path.join(projectPath, '.gitignore');
    const tfqEntry = '.tfq/';
    const comment = '# TFQ test failure queue database';

    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }

    // Check if .tfq/ is already in gitignore
    if (content.includes(tfqEntry)) {
      return;
    }

    // Add entry to gitignore
    const newContent = content.length > 0 && !content.endsWith('\n') 
      ? `${content}\n\n${comment}\n${tfqEntry}\n`
      : `${content}${comment}\n${tfqEntry}\n`;

    fs.writeFileSync(gitignorePath, newContent, 'utf-8');
  }

  private detectWorkspaces(projectPath: string): string[] {
    const workspaces: string[] = [];

    // Check for npm/yarn workspaces in package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        
        if (packageJson.workspaces) {
          // Handle both array and object formats
          const workspacePatterns = Array.isArray(packageJson.workspaces)
            ? packageJson.workspaces
            : packageJson.workspaces.packages || [];

          for (const pattern of workspacePatterns) {
            // Simple glob expansion (just handle * for now)
            if (pattern.includes('*')) {
              const baseDir = pattern.replace('/*', '').replace('*', '');
              const fullPath = path.join(projectPath, baseDir);
              
              if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                const dirs = fs.readdirSync(fullPath)
                  .filter(d => fs.statSync(path.join(fullPath, d)).isDirectory())
                  .map(d => path.join(baseDir, d));
                workspaces.push(...dirs);
              }
            } else {
              workspaces.push(pattern);
            }
          }
        }
      } catch (error) {
        // Ignore parse errors
      }
    }

    // Check for pnpm workspace
    const pnpmWorkspacePath = path.join(projectPath, 'pnpm-workspace.yaml');
    if (fs.existsSync(pnpmWorkspacePath)) {
      // Simple parsing - just look for packages: lines
      const content = fs.readFileSync(pnpmWorkspacePath, 'utf-8');
      const lines = content.split('\n');
      let inPackages = false;
      
      for (const line of lines) {
        if (line.trim() === 'packages:') {
          inPackages = true;
          continue;
        }
        if (inPackages && line.startsWith('  - ')) {
          const pkg = line.substring(4).trim().replace(/['"]/g, '');
          if (!pkg.includes('*')) {
            workspaces.push(pkg);
          }
        } else if (inPackages && !line.startsWith(' ')) {
          break;
        }
      }
    }

    // Check for lerna.json
    const lernaPath = path.join(projectPath, 'lerna.json');
    if (fs.existsSync(lernaPath)) {
      try {
        const lerna = JSON.parse(fs.readFileSync(lernaPath, 'utf-8'));
        if (lerna.packages) {
          for (const pattern of lerna.packages) {
            if (!pattern.includes('*')) {
              workspaces.push(pattern);
            }
          }
        }
      } catch (error) {
        // Ignore parse errors
      }
    }

    return [...new Set(workspaces)]; // Remove duplicates
  }

  async saveConfig(config: TfqConfig, targetPath?: string): Promise<void> {
    this.configManager.writeConfig(config, targetPath);
  }
}