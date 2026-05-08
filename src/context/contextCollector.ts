import * as vscode from 'vscode';
import { ContextSnapshot, ContextSnippet, ControllerDirective, DiagnosticSummary } from '../types';

const DEFAULT_EXCLUDES = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.next/**}';

export class ContextCollector {
  async collectManifest(limit = 120): Promise<ContextSnapshot> {
    const editor = vscode.window.activeTextEditor;
    const workspaceFolders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    const fileManifest = await this.collectFileManifest(limit);
    const diagnostics = this.collectDiagnostics(editor?.document.uri);
    const selection = editor ? this.getSelection(editor, 3000) : undefined;

    return {
      workspaceFolders,
      activeFile: editor ? vscode.workspace.asRelativePath(editor.document.uri, false) : undefined,
      activeLanguage: editor?.document.languageId,
      selection,
      fileManifest,
      diagnostics,
      snippets: []
    };
  }

  async collectForDirective(directive: ControllerDirective): Promise<ContextSnapshot> {
    const snapshot = await this.collectManifest();
    const snippets: ContextSnippet[] = [];
    const editor = vscode.window.activeTextEditor;

    if (editor && directive.toolsToUse.some((tool) => tool.kind === 'activeFile')) {
      snippets.push({
        label: 'activeFile',
        path: vscode.workspace.asRelativePath(editor.document.uri, false),
        content: this.truncate(editor.document.getText(), directive.tokenBudget.cheapContextChars)
      });
    }

    if (editor && directive.toolsToUse.some((tool) => tool.kind === 'selection')) {
      const selected = this.getSelection(editor, directive.tokenBudget.cheapContextChars);
      if (selected) {
        snippets.push({
          label: 'selection',
          path: vscode.workspace.asRelativePath(editor.document.uri, false),
          content: selected
        });
      }
    }

    for (const relativePath of directive.filesToInspect.slice(0, 8)) {
      const snippet = await this.readWorkspaceFile(relativePath, Math.floor(directive.tokenBudget.cheapContextChars / 3));
      if (snippet) {
        snippets.push(snippet);
      }
    }

    return {
      ...snapshot,
      snippets: this.trimSnippets(snippets, directive.tokenBudget.cheapContextChars)
    };
  }

  summarizeForController(snapshot: ContextSnapshot, maxChars: number): string {
    const summary = {
      workspaceFolders: snapshot.workspaceFolders.length,
      activeFile: snapshot.activeFile,
      activeLanguage: snapshot.activeLanguage,
      hasSelection: Boolean(snapshot.selection),
      selectionPreview: snapshot.selection ? this.truncate(snapshot.selection, 500) : undefined,
      diagnostics: snapshot.diagnostics.slice(0, 12),
      fileManifest: snapshot.fileManifest.slice(0, 80)
    };

    return this.truncate(JSON.stringify(summary), maxChars);
  }

  async summarizeControllerEnvironment(maxChars: number): Promise<string> {
    const editor = vscode.window.activeTextEditor;
    const summary = {
      workspaceFolders: vscode.workspace.workspaceFolders?.length ?? 0,
      activeFile: editor ? vscode.workspace.asRelativePath(editor.document.uri, false) : undefined,
      activeLanguage: editor?.document.languageId,
      hasSelection: Boolean(editor && !editor.selection.isEmpty),
      premiumModelMayInspectFilesOrRunTools: false,
      workerAvailableContextRequests: ['activeFile', 'selection', 'diagnostics', 'workspaceFile', 'workspaceSearch', 'terminalCommand']
    };

    return this.truncate(JSON.stringify(summary), maxChars);
  }

  private async collectFileManifest(limit: number): Promise<string[]> {
    if (!vscode.workspace.workspaceFolders?.length) {
      return [];
    }

    const files = await vscode.workspace.findFiles('**/*', DEFAULT_EXCLUDES, limit);
    return files.map((uri) => vscode.workspace.asRelativePath(uri, false)).sort();
  }

  private collectDiagnostics(uri: vscode.Uri | undefined): DiagnosticSummary[] {
    const diagnostics = uri ? vscode.languages.getDiagnostics(uri) : vscode.languages.getDiagnostics().flatMap(([, items]) => items).slice(0, 20);
    return diagnostics.slice(0, 20).map((diagnostic) => ({
      file: uri ? vscode.workspace.asRelativePath(uri, false) : 'workspace',
      severity: vscode.DiagnosticSeverity[diagnostic.severity],
      message: diagnostic.message,
      line: diagnostic.range.start.line + 1
    }));
  }

  private getSelection(editor: vscode.TextEditor, maxChars: number): string | undefined {
    if (editor.selection.isEmpty) {
      return undefined;
    }

    return this.truncate(editor.document.getText(editor.selection), maxChars);
  }

  private async readWorkspaceFile(relativePath: string, maxChars: number): Promise<ContextSnippet | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder || !relativePath || relativePath.includes('..')) {
      return undefined;
    }

    const uri = vscode.Uri.joinPath(folder.uri, ...relativePath.split(/[\\/]+/));
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder('utf-8').decode(bytes);
      return {
        label: 'workspaceFile',
        path: relativePath,
        content: this.truncate(content, maxChars)
      };
    } catch {
      return undefined;
    }
  }

  private trimSnippets(snippets: ContextSnippet[], maxChars: number): ContextSnippet[] {
    let used = 0;
    const trimmed: ContextSnippet[] = [];

    for (const snippet of snippets) {
      const remaining = maxChars - used;
      if (remaining <= 0) {
        break;
      }

      const content = this.truncate(snippet.content, remaining);
      used += content.length;
      trimmed.push({ ...snippet, content });
    }

    return trimmed;
  }

  private truncate(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
      return value;
    }

    return `${value.slice(0, maxChars)}\n[truncated]`;
  }
}