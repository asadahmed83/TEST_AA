import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatState } from '../types';
import { currentEngine, withEngine, type DocContext } from '../lib/ai';
import { getChat, putChat, touch } from '../lib/vault';
import { formatDate, Markdown, uid, useToast } from './ui';

const SUGGESTIONS: Record<string, string[]> = {
  default: ['What is this document about?', 'What are the key dates?', 'Are there any amounts or totals?', 'Who is it from?'],
  object: ['What is this object?', 'Is there any visible text or label?', 'Any visible damage?'],
  id: ['What is the ID number?', 'When does it expire?', 'What is the date of birth?'],
};

export function Chat({ docId, ctx, prefill, onPrefillUsed }: { docId: string; ctx: DocContext; prefill?: string; onPrefillUsed: () => void }) {
  const [chat, setChat] = useState<ChatState | null>(null);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState<'answer' | 'summary' | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  useEffect(() => {
    getChat(docId).then((c) => setChat(c ?? { messages: [], updatedAt: Date.now() }));
  }, [docId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat?.messages.length, thinking]);

  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      inputRef.current?.focus();
      onPrefillUsed();
    }
  }, [prefill, onPrefillUsed]);

  const persist = async (next: ChatState) => {
    setChat(next);
    await putChat(docId, next);
    await touch(docId); // so sync picks up the new history
  };

  const send = async (question: string) => {
    if (!chat || !question.trim() || thinking) return;
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: question.trim(), at: Date.now() };
    const withUser = { ...chat, messages: [...chat.messages, userMsg], updatedAt: Date.now() };
    setInput('');
    await persist(withUser);
    setThinking('answer');
    try {
      const r = await withEngine((e) => e.answer(ctx, chat.messages, question.trim()));
      if (r.fellBack) toast(`Claude unavailable (${r.fellBack}) — answered on-device`, 'error');
      await persist({
        ...withUser,
        messages: [...withUser.messages, { id: uid(), role: 'assistant', content: r.value, at: Date.now(), engine: r.engine }],
        updatedAt: Date.now(),
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setThinking(null);
    }
  };

  const summarize = async () => {
    if (!chat || thinking) return;
    setThinking('summary');
    try {
      const r = await withEngine((e) => e.summarize(ctx));
      if (r.fellBack) toast(`Claude unavailable (${r.fellBack}) — summarised on-device`, 'error');
      await persist({ ...chat, summary: { content: r.value, at: Date.now(), engine: r.engine }, updatedAt: Date.now() });
      setSummaryOpen(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setThinking(null);
    }
  };

  const clear = async () => {
    if (chat && confirm('Delete the chat history for this document? The summary is kept.')) await persist({ ...chat, messages: [], updatedAt: Date.now() });
  };

  if (!chat) return <div className="chat muted">Decrypting chat…</div>;
  const suggestions = ctx.mode === 'object' ? SUGGESTIONS.object : ctx.mode.startsWith('id') ? SUGGESTIONS.id : SUGGESTIONS.default;

  return (
    <div className="chat">
      <div className="chat-head">
        <span>
          💬 Ask this document <small className="badge">{currentEngine().label}</small>
        </span>
        <span>
          <button className="btn sm" onClick={summarize} disabled={!!thinking}>
            {thinking === 'summary' ? 'Summarising…' : chat.summary ? '↻ Summary' : '✨ Summarise'}
          </button>
          {chat.messages.length > 0 && (
            <button className="icon-btn sm" onClick={clear} title="Clear chat history" aria-label="Clear chat history">
              🗑
            </button>
          )}
        </span>
      </div>

      {chat.summary && (
        <div className="pinned">
          <button className="pinned-head" onClick={() => setSummaryOpen(!summaryOpen)}>
            📌 {ctx.mode === 'object' ? 'Analysis' : 'Summary'} <small className="muted">· {formatDate(chat.summary.at)}</small>
            <span className="grow" />
            {summaryOpen ? '▾' : '▸'}
          </button>
          {summaryOpen && <Markdown text={chat.summary.content} />}
        </div>
      )}

      <div className="messages" ref={listRef}>
        {chat.messages.length === 0 && !thinking && (
          <div className="chat-empty">
            <p className="muted">Ask anything about “{ctx.name}”. Answers come only from this document's content.</p>
            <div className="chips">
              {suggestions.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
            <span className="bubble-meta">
              {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {m.engine === 'claude' ? ' · Claude' : m.engine === 'local' ? ' · on-device' : ''}
            </span>
          </div>
        ))}
        {thinking === 'answer' && (
          <div className="bubble assistant typing">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="Ask a question…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <button className="btn primary" disabled={!input.trim() || !!thinking} aria-label="Send">
          ➤
        </button>
      </form>
    </div>
  );
}
