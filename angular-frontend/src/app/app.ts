import { Component, ElementRef, ViewChild, AfterViewChecked, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'error';
  text: string;
  timestamp: Date;
}

interface ChatSession {
  id: number;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
}

interface DbStatus {
  checking: boolean;
  status: 'connected' | 'unavailable' | 'unknown';
  openai: 'configured' | 'missing' | 'unknown';
}

const SUGGESTED_QUESTIONS = [
  'How many farmers are registered?',
  'What is the total sugarcane production?',
  'Show farmers with pending payments.',
  'Which farmer has the highest production?',
  'What is the total amount paid to farmers?',
];

// ── Component ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, AfterViewChecked {

  // ── Chat state ──────────────────────────────────────────────────────────────

  sessions: ChatSession[] = [];
  activeSession: ChatSession | null = null;
  msgIdSeq = 0;
  sessionIdSeq = 0;

  inputText = '';
  isThinking = false;
  sidebarOpen = false;   // mobile toggle

  dbStatus: DbStatus = { checking: true, status: 'unknown', openai: 'unknown' };

  readonly suggestions = SUGGESTED_QUESTIONS;

  // ── DOM refs ────────────────────────────────────────────────────────────────

  @ViewChild('messageList') private messageListRef!: ElementRef<HTMLElement>;
  @ViewChild('chatInput')   private chatInputRef!: ElementRef<HTMLTextAreaElement>;

  private shouldScroll = false;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.checkHealth();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  // ── Health check ────────────────────────────────────────────────────────────

  async checkHealth(): Promise<void> {
    this.dbStatus = { checking: true, status: 'unknown', openai: 'unknown' };
    try {
      const res = await fetch('http://localhost:5001/api/health');
      if (res.ok) {
        const data = await res.json();
        this.dbStatus = {
          checking: false,
          status: data.database === 'connected' ? 'connected' : 'unavailable',
          openai: data.openai === 'configured' ? 'configured' : 'missing',
        };
      } else {
        this.dbStatus = { checking: false, status: 'unavailable', openai: 'unknown' };
      }
    } catch {
      this.dbStatus = { checking: false, status: 'unavailable', openai: 'unknown' };
    }
  }

  // ── Session management ───────────────────────────────────────────────────────

  get messages(): ChatMessage[] {
    return this.activeSession?.messages ?? [];
  }

  get hasMessages(): boolean {
    return this.messages.length > 0;
  }

  newChat(): void {
    if (this.activeSession && this.activeSession.messages.length === 0) return;

    const session: ChatSession = {
      id: ++this.sessionIdSeq,
      title: 'New conversation',
      messages: [],
      createdAt: new Date(),
    };
    this.sessions.unshift(session);
    this.activeSession = session;
    this.inputText = '';
    this.sidebarOpen = false;
  }

  switchSession(session: ChatSession): void {
    this.activeSession = session;
    this.shouldScroll = true;
    this.sidebarOpen = false;
  }

  // ── Messaging ────────────────────────────────────────────────────────────────

  async sendMessage(text?: string): Promise<void> {
    const q = (text ?? this.inputText).trim();
    if (!q || this.isThinking) return;

    // Start a session if none active
    if (!this.activeSession) {
      this.newChat();
    }

    // Update session title from first message
    if (this.activeSession!.messages.length === 0) {
      this.activeSession!.title = q.length > 40 ? q.slice(0, 40) + '…' : q;
    }

    // Add user message
    this.addMessage('user', q);
    this.inputText = '';
    this.isThinking = true;
    this.shouldScroll = true;

    try {
      const res = await fetch('http://localhost:5001/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }

      this.addMessage('assistant', data.answer ?? 'No response from AI.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.addMessage('error',
        `Could not reach the AI assistant: ${msg}\n\nPlease make sure the backend is running:\n  npm run backend:api`);
    } finally {
      this.isThinking = false;
      this.shouldScroll = true;
      this.focusInput();
    }
  }

  selectSuggestion(q: string): void {
    this.sendMessage(q);
  }

  private addMessage(role: ChatMessage['role'], text: string): void {
    this.activeSession!.messages.push({
      id: ++this.msgIdSeq,
      role,
      text,
      timestamp: new Date(),
    });
  }

  // ── Input helpers ────────────────────────────────────────────────────────────

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private focusInput(): void {
    setTimeout(() => this.chatInputRef?.nativeElement?.focus(), 50);
  }

  private scrollToBottom(): void {
    const el = this.messageListRef?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  formatTime(date: Date): string {
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  /** Convert newlines in AI responses to <br> so multiline text renders properly */
  formatText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  trackById(_: number, item: { id: number }): number {
    return item.id;
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }
}