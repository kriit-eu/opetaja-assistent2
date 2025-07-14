export const markdownEditorStyles = `
/* Markdown Editor Wrapper */
.markdown-editor-wrapper {
  width: 100%;
  margin: 16px 0;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background-color: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* Editor Container */
.markdown-editor-container {
  width: 100%;
  min-height: 200px;
}

/* Header with Tabs */
.markdown-editor-header {
  background-color: #f6f8fa;
  border-bottom: 1px solid #d0d7de;
  border-radius: 6px 6px 0 0;
  padding: 8px 16px;
}

.markdown-editor-tabs {
  display: flex;
  gap: 8px;
}

.tab-button {
  background: none;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #656d76;
  transition: all 0.15s ease;
}

.tab-button:hover {
  color: #24292f;
  background-color: #f3f4f6;
}

.tab-button.active {
  color: #24292f;
  background-color: #ffffff;
  border: 1px solid #d0d7de;
  border-bottom: 1px solid #ffffff;
  margin-bottom: -1px;
}

/* Content Area */
.markdown-editor-content {
  position: relative;
  min-height: 200px;
}

.tab-content {
  display: none;
  padding: 16px;
  min-height: 200px;
}

.tab-content.active {
  display: block;
}

/* Markdown Preview */
.markdown-preview {
  min-height: 200px;
  font-size: 14px;
  line-height: 1.6;
  color: #24292f;
  word-wrap: break-word;
}

.markdown-preview h1,
.markdown-preview h2,
.markdown-preview h3,
.markdown-preview h4,
.markdown-preview h5,
.markdown-preview h6 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
}

.markdown-preview h1 {
  font-size: 32px;
  border-bottom: 1px solid #d0d7de;
  padding-bottom: 10px;
}

.markdown-preview h2 {
  font-size: 24px;
  border-bottom: 1px solid #d0d7de;
  padding-bottom: 8px;
}

.markdown-preview h3 {
  font-size: 20px;
}

.markdown-preview h4 {
  font-size: 16px;
}

.markdown-preview h5 {
  font-size: 14px;
}

.markdown-preview h6 {
  font-size: 13px;
  color: #656d76;
}

.markdown-preview p {
  margin-bottom: 16px;
}

.markdown-preview ul,
.markdown-preview ol {
  margin-bottom: 16px;
  padding-left: 32px;
}

.markdown-preview li {
  margin-bottom: 4px;
}

.markdown-preview blockquote {
  margin: 16px 0;
  padding: 0 16px;
  border-left: 4px solid #d0d7de;
  color: #656d76;
}

.markdown-preview code {
  background-color: rgba(175, 184, 193, 0.2);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 85%;
}

.markdown-preview pre {
  background-color: #f6f8fa;
  border-radius: 6px;
  padding: 16px;
  overflow: auto;
  margin: 16px 0;
}

.markdown-preview pre code {
  background-color: transparent;
  padding: 0;
  font-size: 85%;
  line-height: 1.45;
}

.markdown-preview a {
  color: #0969da;
  text-decoration: none;
}

.markdown-preview a:hover {
  text-decoration: underline;
}

.markdown-preview img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

.markdown-preview hr {
  border: none;
  height: 1px;
  background-color: #d0d7de;
  margin: 24px 0;
}

.markdown-preview del {
  text-decoration: line-through;
  color: #656d76;
}

.markdown-preview strong {
  font-weight: 600;
}

.markdown-preview em {
  font-style: italic;
}

/* Textarea */
.markdown-textarea {
  width: 100%;
  min-height: 200px;
  padding: 8px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 14px;
  line-height: 1.5;
  background-color: #ffffff;
  color: #24292f;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s ease;
}

.markdown-textarea:focus {
  border-color: #0969da;
  box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.1);
}

.markdown-textarea::placeholder {
  color: #656d76;
}

/* Toolbar */
.markdown-toolbar {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 0;
  border-top: 1px solid #d0d7de;
  background-color: #f6f8fa;
  border-radius: 0 0 6px 6px;
  padding: 8px 16px;
}

.toolbar-btn {
  background: none;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 14px;
  color: #24292f;
  transition: all 0.15s ease;
  min-width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toolbar-btn:hover {
  background-color: #f3f4f6;
  border-color: #8c959f;
}

.toolbar-btn:active {
  background-color: #e1e4e8;
  border-color: #6e7781;
}

/* Empty state */
.markdown-preview:empty::before {
  content: "Nothing to preview";
  color: #656d76;
  font-style: italic;
  display: block;
  text-align: center;
  padding: 40px 0;
}

/* Mobile responsiveness */
@media (max-width: 768px) {
  .markdown-editor-wrapper {
    margin: 12px 0;
  }
  
  .markdown-editor-header {
    padding: 6px 12px;
  }
  
  .tab-button {
    padding: 6px 12px;
    font-size: 13px;
  }
  
  .tab-content {
    padding: 12px;
  }
  
  .markdown-textarea {
    min-height: 150px;
    font-size: 13px;
  }
  
  .markdown-toolbar {
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 12px;
  }
  
  .toolbar-btn {
    min-width: 28px;
    height: 28px;
    padding: 4px 8px;
    font-size: 12px;
  }
  
  .markdown-preview {
    font-size: 13px;
  }
  
  .markdown-preview h1 {
    font-size: 28px;
  }
  
  .markdown-preview h2 {
    font-size: 22px;
  }
  
  .markdown-preview h3 {
    font-size: 18px;
  }
}

/* Accessibility improvements */
.tab-button:focus {
  outline: 2px solid #0969da;
  outline-offset: 2px;
}

.markdown-textarea:focus {
  outline: none;
}

.toolbar-btn:focus {
  outline: 2px solid #0969da;
  outline-offset: 2px;
}

/* Dark mode support (if needed) */
@media (prefers-color-scheme: dark) {
  .markdown-editor-wrapper {
    background-color: #0d1117;
    border-color: #30363d;
  }
  
  .markdown-editor-header {
    background-color: #161b22;
    border-color: #30363d;
  }
  
  .tab-button {
    color: #8b949e;
  }
  
  .tab-button:hover {
    color: #f0f6fc;
    background-color: #21262d;
  }
  
  .tab-button.active {
    color: #f0f6fc;
    background-color: #0d1117;
    border-color: #30363d;
  }
  
  .markdown-preview {
    color: #f0f6fc;
  }
  
  .markdown-preview h6 {
    color: #8b949e;
  }
  
  .markdown-preview blockquote {
    color: #8b949e;
    border-left-color: #30363d;
  }
  
  .markdown-preview code {
    background-color: rgba(110, 118, 129, 0.4);
  }
  
  .markdown-preview pre {
    background-color: #161b22;
  }
  
  .markdown-preview a {
    color: #58a6ff;
  }
  
  .markdown-preview hr {
    background-color: #30363d;
  }
  
  .markdown-preview del {
    color: #8b949e;
  }
  
  .markdown-textarea {
    background-color: #0d1117;
    color: #f0f6fc;
    border-color: #30363d;
  }
  
  .markdown-textarea:focus {
    border-color: #58a6ff;
    box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.1);
  }
  
  .markdown-textarea::placeholder {
    color: #8b949e;
  }
  
  .markdown-toolbar {
    background-color: #161b22;
    border-color: #30363d;
  }
  
  .toolbar-btn {
    color: #f0f6fc;
    border-color: #30363d;
  }
  
  .toolbar-btn:hover {
    background-color: #21262d;
    border-color: #8b949e;
  }
  
  .toolbar-btn:active {
    background-color: #30363d;
    border-color: #8b949e;
  }
  
  .markdown-preview:empty::before {
    color: #8b949e;
  }
}
`