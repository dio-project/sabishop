import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownLeft, ArrowUpRight, BarChart3, Bell, Check, CheckCheck, ChevronDown,
  CircleHelp, Clock3, Command, CornerDownLeft, Ellipsis, Headphones, Lightbulb,
  Menu, Mic, Package, Search, Send, Settings2, ShoppingBasket, Sparkles, Store,
  TrendingUp, Volume2, X
} from 'lucide-react'

type Product = { id: string; name: string; category: string; price: number; cost: number; stock: number; threshold: number; emoji: string }
type SaleLine = { productId: string; name: string; qty: number; unitPrice: number; unitCost: number }
type Sale = { id: string; lines: SaleLine[]; total: number; createdAt: string }
type Reservation = { id: string; productId: string; name: string; qty: number; status: 'active' | 'cancelled' }
type Draft = { lines: SaleLine[]; total: number }
type Message = { id: string; from: 'user' | 'bot'; text: string; time: string; draft?: Draft; tag?: string }
type SavedState = { products: Product[]; sales: Sale[]; reservations: Reservation[] }

const seedProducts: Product[] = [
  { id: 'indomie', name: 'Indomie Chicken', category: 'Noodles', price: 500, cost: 390, stock: 42, threshold: 15, emoji: '🍜' },
  { id: 'peak', name: 'Peak Milk Sachet', category: 'Dairy', price: 250, cost: 190, stock: 18, threshold: 20, emoji: '🥛' },
  { id: 'pasta', name: 'Golden Penny Pasta', category: 'Groceries', price: 850, cost: 680, stock: 27, threshold: 10, emoji: '🍝' },
  { id: 'sugar', name: 'Dangote Sugar 500g', category: 'Groceries', price: 1200, cost: 980, stock: 9, threshold: 12, emoji: '🧂' },
  { id: 'milo', name: 'Milo Sachet', category: 'Beverages', price: 200, cost: 150, stock: 31, threshold: 12, emoji: '🍫' },
  { id: 'water', name: 'Eva Water 75cl', category: 'Drinks', price: 300, cost: 180, stock: 56, threshold: 18, emoji: '💧' },
]
const starterMessages: Message[] = [
  { id: 'welcome', from: 'bot', text: 'Good afternoon! 👋🏾\n\nI’m Sabi, your shop assistant. Tell me what sold, ask about your stock, or let me help you plan your next restock.', time: '2:41 PM', tag: 'SABI ASSISTANT' },
  { id: 'hint', from: 'bot', text: 'Try “I sold 3 Indomie and 2 Milo” — I’ll check the items and prices with you before recording the sale.', time: '2:41 PM' },
]
const money = (value: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(value)
const clock = () => new Date().toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })
const newId = () => Math.random().toString(36).slice(2, 10)

function initialSavedState(): SavedState {
  try {
    const raw = localStorage.getItem('sabishop-demo-v1')
    if (raw) return JSON.parse(raw) as SavedState
  } catch { /* Continue with seed data if browser storage is unavailable. */ }
  return { products: seedProducts, sales: [], reservations: [] }
}

function App() {
  const [saved, setSaved] = useState<SavedState>(initialSavedState)
  const [messages, setMessages] = useState<Message[]>(starterMessages)
  const [input, setInput] = useState('')
  const [role, setRole] = useState<'retailer' | 'customer'>('retailer')
  const [recording, setRecording] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [showStock, setShowStock] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [notice, setNotice] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try { localStorage.setItem('sabishop-demo-v1', JSON.stringify(saved)) } catch { /* Demo remains usable for this session. */ }
  }, [saved])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])

  const activeReservations = useMemo(() => saved.reservations.filter(r => r.status === 'active'), [saved.reservations])
  const reservedByProduct = useMemo(() => activeReservations.reduce<Record<string, number>>((acc, r) => {
    acc[r.productId] = (acc[r.productId] ?? 0) + r.qty
    return acc
  }, {}), [activeReservations])
  const todaySales = saved.sales.reduce((sum, sale) => sum + sale.total, 0)
  const todayProfit = saved.sales.reduce((sum, sale) => sum + sale.lines.reduce((n, line) => n + (line.unitPrice - line.unitCost) * line.qty, 0), 0)
  const lowStock = saved.products.filter(p => p.stock - (reservedByProduct[p.id] ?? 0) <= p.threshold)

  const addMessage = (message: Omit<Message, 'id' | 'time'> & { time?: string }) => {
    setMessages(prev => [...prev, { ...message, id: newId(), time: message.time ?? clock() }])
  }
  const matchProduct = (text: string) => {
    const normalized = text.toLowerCase()
    return saved.products.find(p => normalized.includes(p.name.toLowerCase()) || normalized.includes(p.id.replaceAll('-', ' ')))
  }

  function parseSale(text: string): Draft | null {
    const lower = text.toLowerCase()
    if (!/(sold|sell|sale|record|customer bought|just sold)/.test(lower)) return null
    const lines: SaleLine[] = []
    for (const product of saved.products) {
      const name = product.name.toLowerCase()
      const nameAt = lower.indexOf(name)
      const idAt = lower.indexOf(product.id.replaceAll('-', ' '))
      const foundAt = nameAt >= 0 ? nameAt : idAt
      if (foundAt < 0) continue
      const before = lower.slice(Math.max(0, foundAt - 18), foundAt)
      const after = lower.slice(foundAt + (nameAt >= 0 ? name.length : product.id.length))
      const beforeMatch = before.match(/(\d+)\s*(?:x\s*)?$/)
      const afterMatch = after.match(/^\s*(?:x\s*)?(\d+)/)
      const qty = Number(beforeMatch?.[1] ?? afterMatch?.[1] ?? 1)
      if (qty > 0 && Number.isSafeInteger(qty)) lines.push({ productId: product.id, name: product.name, qty, unitPrice: product.price, unitCost: product.cost })
    }
    if (!lines.length) {
      const product = matchProduct(text)
      if (product) lines.push({ productId: product.id, name: product.name, qty: Number(lower.match(/\b(\d+)\b/)?.[1] ?? 1), unitPrice: product.price, unitCost: product.cost })
    }
    if (!lines.length) return null
    return { lines, total: lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0) }
  }

  function respond(text: string) {
    const lower = text.toLowerCase()
    if (/(help|what can you do|examples)/.test(lower)) {
      addMessage({ from: 'bot', text: 'I can help record sales, check available stock, spot items to restock, and summarise recorded sales and gross profit.\n\nTry:\n• “I sold 3 Indomie Chicken”\n• “What should I restock?”\n• “How much did I make today?”\n• “Do you have Peak Milk?”' })
      return
    }
    if (/(restock|low stock|running low|buy more|reorder)/.test(lower)) {
      const items = lowStock.length ? lowStock.map(p => '• ' + p.emoji + ' ' + p.name + ': ' + Math.max(0, p.stock - (reservedByProduct[p.id] ?? 0)) + ' available (threshold ' + p.threshold + ')').join('\n') : 'Nothing is below its current restock threshold.'
      addMessage({ from: 'bot', text: 'Restock check, based on the stock currently recorded:\n\n' + items + '\n\nThis is a threshold alert, not a prediction of future demand.', tag: 'STOCK CHECK' })
      return
    }
    if (/(profit|made today|sales today|revenue|how much.*today|performance|summary|business.*today)/.test(lower)) {
      const units = saved.sales.reduce((sum, sale) => sum + sale.lines.reduce((n, line) => n + line.qty, 0), 0)
      addMessage({ from: 'bot', text: 'Your recorded demo-session results:\n\nRevenue: ' + money(todaySales) + '\nEstimated gross profit: ' + money(todayProfit) + '\nCompleted sales: ' + saved.sales.length + '\nUnits sold: ' + units + '\n\nGross profit subtracts recorded cost of goods only. It excludes rent, transport, wages and other operating expenses.', tag: 'BUSINESS SNAPSHOT' })
      return
    }
    if (/(reserve|keep.*aside|hold.*for me|book)/.test(lower) && role === 'customer') {
      const product = matchProduct(text)
      const qty = Number(lower.match(/\b(\d+)\b/)?.[1] ?? 1)
      if (!product) { addMessage({ from: 'bot', text: 'Which item would you like me to reserve? Try “Reserve 2 Indomie Chicken”.' }); return }
      const available = product.stock - (reservedByProduct[product.id] ?? 0)
      if (qty > available) { addMessage({ from: 'bot', text: 'I can’t reserve ' + qty + ' ' + product.name + ': only ' + available + ' are available right now.' }); return }
      const reservation: Reservation = { id: newId(), productId: product.id, name: product.name, qty, status: 'active' }
      setSaved(prev => ({ ...prev, reservations: [...prev.reservations, reservation] }))
      addMessage({ from: 'bot', text: 'Reservation confirmed: ' + qty + ' × ' + product.name + '.\n\nPlease collect it from the shop and pay there. This is a demo reservation.', tag: 'RESERVATION CONFIRMED' })
      return
    }
    if (/(cancel.*reservation|cancel.*reserve)/.test(lower) && role === 'customer') {
      const reservation = activeReservations.at(-1)
      if (!reservation) addMessage({ from: 'bot', text: 'There are no active demo reservations to cancel.' })
      else {
        setSaved(prev => ({ ...prev, reservations: prev.reservations.map(r => r.id === reservation.id ? { ...r, status: 'cancelled' } : r) }))
        addMessage({ from: 'bot', text: 'Cancelled your reservation for ' + reservation.qty + ' × ' + reservation.name + '. The items are available again.' })
      }
      return
    }
    if (/(available|in stock|do you have|got any|how many|stock of)/.test(lower)) {
      const product = matchProduct(text)
      if (!product) { addMessage({ from: 'bot', text: 'I can check: ' + saved.products.map(p => p.name).join(', ') + '. Which one do you need?' }); return }
      const available = product.stock - (reservedByProduct[product.id] ?? 0)
      addMessage({ from: 'bot', text: (available > 0 ? 'Yes — ' + product.name + ' is available.' : 'Sorry, ' + product.name + ' is currently unavailable.') + '\n\n' + available + ' available · ' + money(product.price) + ' each' + (role === 'customer' && available > 0 ? '\n\nSay “Reserve 2 ' + product.name + '” to hold some for collection.' : ''), tag: 'LIVE STOCK LOOKUP' })
      return
    }
    if (/(sold|sell|sale|record|customer bought|just sold)/.test(lower) && role === 'retailer') {
      const draft = parseSale(text)
      if (!draft) { addMessage({ from: 'bot', text: 'I couldn’t confidently match the items. Include the product name and quantity, e.g. “I sold 3 Indomie Chicken”. I won’t change stock until you confirm.' }); return }
      const unavailable = draft.lines.filter(line => {
        const product = saved.products.find(p => p.id === line.productId)
        return !product || line.qty > product.stock - (reservedByProduct[line.productId] ?? 0)
      })
      if (unavailable.length) { addMessage({ from: 'bot', text: 'I can’t prepare that sale because ' + unavailable.map(line => line.name).join(', ') + ' has insufficient available stock. Nothing has been recorded.' }); return }
      addMessage({ from: 'bot', text: 'Please check the items and total below. Stock will only change after you confirm.', draft, tag: 'CONFIRM SALE' })
      return
    }
    addMessage({ from: 'bot', text: role === 'retailer'
      ? 'I can help with sales, stock checks and business summaries. Try “I sold 3 Indomie”, “What should I restock?” or “How much did I make today?”'
      : 'Ask about product availability or reserve items for collection. For example: “Do you have Peak Milk?”' })
  }

  function send(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text) return
    addMessage({ from: 'user', text })
    setInput('')
    respond(text)
    inputRef.current?.focus()
  }

  function confirmSale(draft: Draft) {
    const insufficient = draft.lines.find(line => {
      const product = saved.products.find(p => p.id === line.productId)
      return !product || line.qty > product.stock - (reservedByProduct[line.productId] ?? 0)
    })
    if (insufficient) { addMessage({ from: 'bot', text: 'Stock changed while this sale awaited confirmation. ' + insufficient.name + ' is no longer available in that quantity. Please try again.' }); return }
    const sale: Sale = { id: newId(), lines: draft.lines, total: draft.total, createdAt: new Date().toISOString() }
    setSaved(prev => ({
      ...prev,
      products: prev.products.map(p => {
        const line = draft.lines.find(item => item.productId === p.id)
        return line ? { ...p, stock: p.stock - line.qty } : p
      }),
      sales: [...prev.sales, sale],
    }))
    setMessages(prev => prev.map(m => m.draft === draft ? { ...m, draft: undefined, tag: 'SALE RECORDED', text: 'Sale recorded successfully.\n\n' + draft.lines.map(line => line.qty + ' × ' + line.name).join('\n') + '\nTotal: ' + money(draft.total) + '\n\nStock has been updated in this browser demo.' } : m))
    addMessage({ from: 'bot', text: 'Done. ' + money(draft.total) + ' in sales recorded. I’ve updated the demo stock balance.', tag: 'TRANSACTION COMPLETE' })
  }

  function startVoice() {
    type RecognitionResult = { results: { [index: number]: { [index: number]: { transcript: string } } } }
    type Recognition = { lang: string; onresult: (event: RecognitionResult) => void; onerror: () => void; onend: () => void; start: () => void }
    const speechWindow = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
    const Speech = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!Speech) { setNotice('Voice typing is not supported in this browser. Type your message instead.'); window.setTimeout(() => setNotice(''), 3500); return }
    try {
      const recognition = new Speech()
      recognition.lang = 'en-NG'
      recognition.onresult = event => setInput(event.results[0][0].transcript)
      recognition.onerror = () => { setRecording(false); setNotice('Could not hear that clearly. Try again or type your message.'); window.setTimeout(() => setNotice(''), 3500) }
      recognition.onend = () => setRecording(false)
      setRecording(true)
      recognition.start()
    } catch {
      setRecording(false)
      setNotice('Microphone access is unavailable. Check browser permissions.')
      window.setTimeout(() => setNotice(''), 3500)
    }
  }

  function resetDemo() {
    setSaved({ products: seedProducts, sales: [], reservations: [] })
    setMessages(starterMessages)
    setNotice('Demo data reset.')
    window.setTimeout(() => setNotice(''), 2500)
  }

  return (
    <div className="app-shell">
      {mobileNav && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={'sidebar ' + (mobileNav ? 'sidebar-open' : '')}>
        <div className="brand-lockup"><div className="brand-mark"><ShoppingBasket size={21} strokeWidth={2.5} /></div><div><span className="brand-name">sabi<span>shop</span></span><span className="brand-caption">YOUR SHOP, IN CONTROL</span></div><button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
        <button className="shop-switcher" onClick={() => setNotice('Shop switching will be added in the multi-shop release.')}><div className="shop-avatar"><Store size={18} /></div><div className="shop-switcher-copy"><strong>Dio’s Provision Store</strong><span>Retailer workspace</span></div><ChevronDown size={15} className="muted-icon" /></button>
        <div className="nav-label">WORKSPACE</div>
        <button className={'nav-item ' + (!showStock ? 'active' : '')} onClick={() => { setShowStock(false); setMobileNav(false) }}><Command size={17} /><span>Assistant</span><span className="nav-pulse" /></button>
        <button className={'nav-item ' + (showStock ? 'active' : '')} onClick={() => { setShowStock(!showStock); setMobileNav(false) }}><Package size={17} /><span>Inventory</span><span className="nav-count">{saved.products.length}</span></button>
        <button className="nav-item" onClick={() => send('How much did I make today?')}><BarChart3 size={17} /><span>Business insights</span></button>
        <button className="nav-item" onClick={() => send('What should I restock?')}><Bell size={17} /><span>Stock alerts</span>{lowStock.length > 0 && <span className="alert-count">{lowStock.length}</span>}</button>
        <div className="sidebar-divider" /><div className="nav-label">DEMO MODE</div>
        <div className="demo-note"><div className="demo-note-icon"><Sparkles size={15} /></div><div><strong>Interactive preview</strong><p>Try shop tasks. Demo changes stay in this browser.</p></div></div>
        <div className="sidebar-bottom"><div className="support-card"><div className="support-icon"><Headphones size={17} /></div><div><strong>Need a hand?</strong><span>Explore what Sabi can do</span></div><button className="icon-button" aria-label="Show help" onClick={() => setShowHelp(true)}><CircleHelp size={16} /></button></div>
          <button className="profile-row" onClick={() => setNotice('Signed in as demo retailer. Authentication will be connected with Supabase.')}><div className="profile-avatar">D</div><div className="profile-copy"><strong>Dio</strong><span>Shop owner</span></div><Ellipsis size={19} className="muted-icon" /></button></div>
      </aside>

      <main className="main-panel">
        <header className="topbar"><div className="topbar-left"><button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{showStock ? 'Inventory' : 'Assistant'}</strong></div></div>
          <div className="topbar-right"><div className="demo-pill"><span className="status-dot" /> DEMO ENVIRONMENT</div><button className="icon-button topbar-help" aria-label="Help" onClick={() => setShowHelp(true)}><CircleHelp size={18} /></button><button className="icon-button" aria-label="Notifications" onClick={() => send('What should I restock?')}><Bell size={18} />{lowStock.length > 0 && <span className="notification-dot" />}</button></div></header>

        {showStock ? <section className="inventory-page">
          <div className="page-heading"><div><div className="eyebrow">YOUR SHOP AT A GLANCE</div><h1>Inventory</h1><p>Know what’s on the shelf before your next customer asks.</p></div><button className="secondary-button" onClick={resetDemo}><Settings2 size={16} /> Reset demo</button></div>
          <div className="metric-grid"><Metric icon={<Package size={18} />} label="Products tracked" value={String(saved.products.length)} detail="Across your shop" /><Metric icon={<Bell size={18} />} label="Need attention" value={String(lowStock.length)} detail="At or below threshold" warn={lowStock.length > 0} /><Metric icon={<ShoppingBasket size={18} />} label="Units reserved" value={String(activeReservations.reduce((sum, r) => sum + r.qty, 0))} detail="Not yet collected" /></div>
          <div className="inventory-card"><div className="card-heading"><div><h2>Stock on hand</h2><p>Available quantity excludes active reservations.</p></div><span className="table-tag">LIVE DEMO DATA</span></div>
            <div className="product-table"><div className="product-row product-table-head"><span>PRODUCT</span><span>SELLING PRICE</span><span>AVAILABLE</span><span>STATUS</span></div>
              {saved.products.map(product => { const available = product.stock - (reservedByProduct[product.id] ?? 0); const isLow = available <= product.threshold; return <div className="product-row" key={product.id}><div className="product-name-cell"><span className="product-emoji">{product.emoji}</span><div><strong>{product.name}</strong><small>{product.category}</small></div></div><strong>{money(product.price)}</strong><strong className={isLow ? 'low-number' : ''}>{available} <small>units</small></strong><span className={'stock-status ' + (isLow ? 'status-low' : 'status-good')}><i />{isLow ? 'Restock soon' : 'In stock'}</span></div> })}
            </div>
          </div><button className="back-to-chat" onClick={() => setShowStock(false)}>← Back to Sabi assistant</button>
        </section> : <section className="assistant-layout">
          <div className="chat-column">
            <div className="chat-heading"><div className="assistant-identity"><div className="assistant-avatar"><Sparkles size={21} /></div><div><h1>Sabi assistant <span className="verified"><Check size={10} /></span></h1><div className="assistant-subtitle"><span className="status-dot" /> Ready to help <span className="subtitle-divider">·</span> Understands everyday language</div></div></div><div className="chat-heading-actions"><button className="icon-button" title="Voice output" onClick={() => setNotice('Spoken responses will be added with the voice feature.')}><Volume2 size={17} /></button><button className="icon-button" title="Reset demo" onClick={resetDemo}><Ellipsis size={19} /></button></div></div>
            <div className="mode-banner"><div className="mode-banner-icon"><Lightbulb size={16} /></div><div><strong>What do you need to do today?</strong><span>Tell Sabi like you’d tell a shop assistant. No forms to fill.</span></div><button onClick={() => setShowHelp(true)}>See examples <ArrowUpRight size={13} /></button></div>
            <div className="chat-scroll"><div className="date-divider"><span>TODAY</span></div><div className="messages">
              {messages.map(message => <div className={'message-row ' + (message.from === 'user' ? 'message-row-user' : '')} key={message.id}>
                {message.from === 'bot' && <div className="message-avatar"><Sparkles size={14} /></div>}
                <div className={'message-content ' + (message.from === 'user' ? 'message-content-user' : '')}>
                  {message.tag && <div className={'message-tag ' + (/(RECORDED|COMPLETE|CONFIRMED)/.test(message.tag) ? 'tag-success' : '')}>{message.tag}</div>}
                  <div className={'message-bubble ' + (message.from === 'user' ? 'user-bubble' : 'bot-bubble')}><p>{message.text}</p>
                    {message.draft && <div className="sale-confirm-card"><div className="sale-card-title"><div><span className="sale-card-icon"><ShoppingBasket size={15} /></span><strong>Sale summary</strong></div><span className="awaiting-pill"><Clock3 size={11} /> Awaiting confirmation</span></div>
                      {message.draft.lines.map(line => <div className="sale-line" key={line.productId}><div><strong>{line.qty} × {line.name}</strong><span>{money(line.unitPrice)} each</span></div><strong>{money(line.qty * line.unitPrice)}</strong></div>)}
                      <div className="sale-total"><span>Total sale value</span><strong>{money(message.draft.total)}</strong></div><div className="sale-card-foot"><span><Lightbulb size={13} /> Stock updates after confirmation</span><button onClick={() => confirmSale(message.draft!)}><Check size={14} /> Confirm sale</button></div>
                    </div>}
                  </div><div className={'message-meta ' + (message.from === 'user' ? 'meta-user' : '')}><span>{message.time}</span>{message.from === 'user' && <CheckCheck size={13} />}</div>
                </div>
              </div>)}<div ref={bottomRef} /></div></div>
            <div className="composer-area"><div className="quick-prompt-label"><span>QUICK ACTIONS</span><span>Pick one to get started</span></div>
              <div className="quick-prompts">{(role === 'retailer' ? [
                { icon: <ArrowDownLeft size={14} />, label: 'Record a sale', prompt: 'I sold 3 Indomie Chicken and 2 Milo Sachet' },
                { icon: <Package size={14} />, label: 'Check stock', prompt: 'What should I restock?' },
                { icon: <TrendingUp size={14} />, label: 'Today’s numbers', prompt: 'How much did I make today?' },
              ] : [
                { icon: <Search size={14} />, label: 'Find a product', prompt: 'Do you have Peak Milk Sachet?' },
                { icon: <ShoppingBasket size={14} />, label: 'Reserve an item', prompt: 'Reserve 2 Indomie Chicken' },
                { icon: <X size={14} />, label: 'Cancel reservation', prompt: 'Cancel my reservation' },
              ]).map(item => <button className="quick-prompt" key={item.label} onClick={() => send(item.prompt)}>{item.icon}<span>{item.label}</span></button>)}</div>
              <form className="composer" onSubmit={e => { e.preventDefault(); send() }}><button type="button" className={'composer-icon ' + (recording ? 'recording' : '')} aria-label="Voice input" onClick={startVoice}><Mic size={18} /></button><input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} placeholder={role === 'retailer' ? 'Tell Sabi what happened in your shop…' : 'Ask about a product or reserve an item…'} aria-label="Message Sabi assistant" /><span className="composer-shortcut"><CornerDownLeft size={13} /> Enter</span><button type="submit" className="send-button" disabled={!input.trim()} aria-label="Send message"><Send size={16} /></button></form>
              <div className="composer-foot"><span><Sparkles size={12} /> Sabi understands your words — you stay in control.</span><span>Built for everyday retail</span></div>
            </div>
          </div>
          <aside className="insights-panel"><div className="insights-title"><div><h2>Shop snapshot</h2><p>A quick look at your business</p></div><button className="icon-button" aria-label="Open inventory" onClick={() => setShowStock(true)}><ArrowUpRight size={16} /></button></div>
            <div className="snapshot-card"><div className="snapshot-card-top"><span className="snapshot-icon revenue-icon"><TrendingUp size={17} /></span><span className="snapshot-period">THIS DEMO SESSION</span></div><div className="snapshot-label">Sales recorded</div><div className="snapshot-value">{money(todaySales)}</div><div className="snapshot-sub"><span className="snapshot-dot" /> {saved.sales.length} completed {saved.sales.length === 1 ? 'sale' : 'sales'}</div><div className="snapshot-divider" /><div className="snapshot-card-top"><span className="snapshot-icon profit-icon"><BarChart3 size={17} /></span><span className="snapshot-period">ESTIMATED</span></div><div className="snapshot-label">Gross profit</div><div className="snapshot-value">{money(todayProfit)}</div><div className="snapshot-sub">Before operating expenses</div></div>
            <div className="side-card stock-alert-card"><div className="side-card-heading"><div className="side-card-title-icon alert-title-icon"><Bell size={15} /></div><div><h3>Needs your attention</h3><p>{lowStock.length ? lowStock.length + ' items at restock threshold' : 'Stock levels look good'}</p></div><span className="side-card-number">{lowStock.length}</span></div>
              {lowStock.length ? lowStock.slice(0, 3).map(p => <div className="alert-product" key={p.id}><span className="alert-product-emoji">{p.emoji}</span><div className="alert-product-copy"><strong>{p.name}</strong><span>{Math.max(0, p.stock - (reservedByProduct[p.id] ?? 0))} available · threshold {p.threshold}</span></div><span className="alert-indicator" /></div>) : <div className="empty-alert"><Check size={16} /> No items need restocking right now.</div>}
              <button className="text-action" onClick={() => send('What should I restock?')}>Ask Sabi to review stock <ArrowUpRight size={14} /></button>
            </div>
            <div className="side-card role-card"><div className="role-card-heading"><div className="side-card-title-icon role-title-icon"><Store size={15} /></div><div><h3>Preview as</h3><p>Switch the demo perspective</p></div></div>
              <div className="role-toggle"><button className={role === 'retailer' ? 'role-selected' : ''} onClick={() => { setRole('retailer'); setMessages(starterMessages) }}><Store size={14} /> Shop owner</button><button className={role === 'customer' ? 'role-selected' : ''} onClick={() => { setRole('customer'); setMessages([{ id: newId(), from: 'bot', text: 'Welcome! I can help you check what’s available at Dio’s Provision Store and reserve items for collection. What are you looking for?', time: clock(), tag: 'CUSTOMER ASSISTANT' }]) }}><Search size={14} /> Customer</button></div>
              <p className="role-note">Same shop data, different tasks. Reservations reduce available stock without recording a sale.</p>
            </div>
            <div className="privacy-note"><div className="privacy-lock"><Check size={13} /></div><p><strong>Designed for trusted records</strong><br />Sabi asks before recording a sale. AI suggestions never change stock by themselves.</p></div><button className="reset-link" onClick={resetDemo}>Reset demo data</button>
          </aside>
        </section>}
        <footer className="app-footer"><span>© 2026 SabiShop</span><span><span className="footer-status-dot" /> Demo mode · Data stored in this browser</span><button onClick={() => setShowHelp(true)}>Help & examples <ArrowUpRight size={12} /></button></footer>
      </main>
      {notice && <div className="toast"><Check size={15} />{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}><X size={14} /></button></div>}
      {showHelp && <div className="modal-backdrop" onClick={() => setShowHelp(false)}><section className="help-modal" onClick={e => e.stopPropagation()}><div className="help-modal-head"><div className="assistant-avatar"><Sparkles size={20} /></div><div><h2>What can Sabi help with?</h2><p>Use everyday language. Check the result before you commit.</p></div><button className="icon-button" aria-label="Close help" onClick={() => setShowHelp(false)}><X size={18} /></button></div>
        <div className="help-examples">{[
          { title: 'Record a sale', text: 'I sold 3 Indomie Chicken and 2 Milo Sachet', desc: 'Sabi checks quantity and value, then asks you to confirm.' },
          { title: 'Review stock', text: 'What should I restock?', desc: 'See products at or below your configured stock threshold.' },
          { title: 'Understand performance', text: 'How much did I make today?', desc: 'Get recorded revenue and gross profit, with assumptions stated.' },
          { title: 'Help a customer', text: 'Do you have Peak Milk Sachet?', desc: 'Check availability or reserve items for collection.' },
        ].map(example => <button key={example.title} className="help-example" onClick={() => { setShowHelp(false); send(example.text) }}><span><strong>{example.title}</strong><small>{example.desc}</small><em>{example.text}</em></span><ArrowUpRight size={16} /></button>)}</div>
        <div className="help-modal-foot"><Lightbulb size={15} /><span>Demo note: transactions are saved in this browser only. Supabase and live AI will be connected in the next build step.</span></div></section></div>}
    </div>
  )
}

function Metric({ icon, label, value, detail, warn = false }: { icon: React.ReactNode; label: string; value: string; detail: string; warn?: boolean }) {
  return <div className="metric-card"><div className={'metric-icon ' + (warn ? 'metric-warn' : '')}>{icon}</div><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><span className="metric-detail">{detail}</span></div>
}

export default App