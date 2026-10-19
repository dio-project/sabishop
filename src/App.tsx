import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import './live.css'

type Product = {
  id: string
  shop_id: string
  name: string
  normalized_name: string
  category: string
  selling_price_kobo: number
  unit_cost_kobo: number
  stock_quantity: number
  low_stock_threshold: number
  is_active: boolean
}
type SaleLine = { product_id: string; name: string; quantity: number; unit_price_kobo: number; unit_cost_kobo: number }
type SaleDraft = { items: SaleLine[]; total_kobo: number; idempotency_key: string }
type ChatMessage = { id: string; role: 'assistant' | 'user'; text: string; draft?: SaleDraft }
type Sale = { id: string; total_kobo: number; created_at: string }
type Tab = 'assistant' | 'inventory' | 'sales'

const sampleProducts = [
  { name: 'Indomie Chicken', category: 'Noodles', price: 500, cost: 390, stock: 42, threshold: 15 },
  { name: 'Peak Milk Sachet', category: 'Dairy', price: 250, cost: 190, stock: 18, threshold: 20 },
  { name: 'Golden Penny Pasta', category: 'Groceries', price: 850, cost: 680, stock: 27, threshold: 10 },
  { name: 'Dangote Sugar 500g', category: 'Groceries', price: 1200, cost: 980, stock: 9, threshold: 12 },
  { name: 'Milo Sachet', category: 'Beverages', price: 200, cost: 150, stock: 31, threshold: 12 },
  { name: 'Eva Water 75cl', category: 'Drinks', price: 300, cost: 180, stock: 56, threshold: 18 },
]
const money = (kobo: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 }).format(kobo / 100)
const uid = () => crypto.randomUUID()
const greeting: ChatMessage[] = [{ id: 'welcome', role: 'assistant', text: 'Good afternoon. I’m Sabi, your shop assistant. Tell me what sold, ask about stock, or request a summary. I’ll check the details and ask before recording a sale.' }]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shopName, setShopName] = useState('Dio’s Provision Store')
  const [shopId, setShopId] = useState('')
  const [shopTitle, setShopTitle] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [tab, setTab] = useState<Tab>('assistant')
  const [messages, setMessages] = useState<ChatMessage[]>(greeting)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [authError, setAuthError] = useState('')
  const [productForm, setProductForm] = useState({ name: '', category: 'General', price: '', cost: '', stock: '', threshold: '5' })
  const [restockValues, setRestockValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session || !supabase) {
      setShopId('')
      setProducts([])
      setSales([])
      return
    }
    void loadWorkspace(session.user.id)
  }, [session?.user.id])

  const lowStock = useMemo(() => products.filter(p => p.is_active && p.stock_quantity <= p.low_stock_threshold), [products])
  const todaySales = useMemo(() => sales.filter(s => new Date(s.created_at).toDateString() === new Date().toDateString()), [sales])
  const todayRevenue = todaySales.reduce((sum, s) => sum + Number(s.total_kobo), 0)

  async function loadWorkspace(userId: string) {
    if (!supabase) return
    setLoading(true)
    try {
      let { data: membership, error: membershipError } = await supabase.from('shop_members').select('shop_id, role').eq('user_id', userId).limit(1).maybeSingle()
      if (membershipError) throw membershipError
      let id = membership?.shop_id as string | undefined
      if (!id) {
        const { data, error } = await supabase.rpc('create_shop_with_owner', { p_name: shopName.trim() || 'My Provision Store' })
        if (error) throw error
        id = data as string
      }
      if (!id) throw new Error('Could not create or load your shop.')
      setShopId(id)
      const { data: shop, error: shopError } = await supabase.from('shops').select('name').eq('id', id).single()
      if (shopError) throw shopError
      setShopTitle(shop.name)
      const { data: currentProducts, error: productsError } = await supabase.from('products').select('*').eq('shop_id', id).eq('is_active', true).order('name')
      if (productsError) throw productsError
      let productRows = (currentProducts ?? []) as Product[]
      if (!productRows.length) {
        const seedRows = sampleProducts.map(p => ({
          shop_id: id, name: p.name, normalized_name: p.name.toLowerCase(), category: p.category,
          selling_price_kobo: p.price * 100, unit_cost_kobo: p.cost * 100,
          stock_quantity: p.stock, low_stock_threshold: p.threshold, is_active: true,
        }))
        const { data: seeded, error: seedError } = await supabase.from('products').insert(seedRows).select('*').order('name')
        if (seedError) throw seedError
        productRows = (seeded ?? []) as Product[]
        setNotice('A sample catalogue was added. Replace sample stock counts and prices before using real shop records.')
      }
      setProducts(productRows)
      const { data: currentSales, error: salesError } = await supabase.from('sales').select('id,total_kobo,created_at').eq('shop_id', id).eq('status', 'completed').order('created_at', { ascending: false }).limit(100)
      if (salesError) throw salesError
      setSales((currentSales ?? []) as Sale[])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load the shop workspace.')
    } finally {
      setLoading(false)
    }
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setAuthError('')
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) throw error
        if (!data.session) {
          setAuthError('Account created. Check your email for the confirmation link, then sign in.')
        } else {
          setNotice('Account created. Setting up your shop…')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setMessages(greeting)
    setTab('assistant')
  }

  function addMessage(message: Omit<ChatMessage, 'id'>) {
    setMessages(prev => [...prev, { ...message, id: uid() }])
  }

  function resolveProduct(name: string): Product | undefined {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ')
    return products.find(p => p.normalized_name === normalized || p.name.toLowerCase() === normalized)
      ?? products.find(p => normalized.length > 2 && (p.normalized_name.includes(normalized) || normalized.includes(p.normalized_name)))
  }

  function fallbackInterpretation(text: string) {
    const lower = text.toLowerCase()
    if (/(profit|revenue|sales today|how much.*today|business summary|performance)/.test(lower)) return { intent: 'business_summary', items: [], confidence: 0.5, needs_confirmation: false, clarifying_question: '' }
    if (/(restock|low stock|running low|reorder|buy more)/.test(lower)) return { intent: 'restock_advice', items: [], confidence: 0.5, needs_confirmation: false, clarifying_question: '' }
    const matched = products.filter(p => lower.includes(p.name.toLowerCase()))
    if (/(stock|available|do you have|how many|in stock)/.test(lower)) return { intent: 'check_stock', items: matched.map(p => ({ product_name: p.name, quantity: 1 })), confidence: matched.length ? 0.7 : 0.3, needs_confirmation: false, clarifying_question: '' }
    if (/(sold|sale|record|customer bought|just sold)/.test(lower)) {
      const items = matched.map(p => {
        const before = lower.slice(Math.max(0, lower.indexOf(p.name.toLowerCase()) - 18), lower.indexOf(p.name.toLowerCase()))
        const after = lower.slice(lower.indexOf(p.name.toLowerCase()) + p.name.length)
        const qty = Number(before.match(/(\d+)\s*(?:x\s*)?$/)?.[1] ?? after.match(/^\s*(?:x\s*)?(\d+)/)?.[1] ?? 1)
        return { product_name: p.name, quantity: qty }
      })
      return { intent: items.length ? 'record_sale' : 'unknown', items, confidence: items.length ? 0.6 : 0.2, needs_confirmation: true, clarifying_question: items.length ? '' : 'Which product and quantity did you sell?' }
    }
    return { intent: 'unknown', items: [], confidence: 0, needs_confirmation: false, clarifying_question: 'Try “I sold 3 Indomie Chicken”, “What should I restock?” or “Do you have Peak Milk Sachet?”' }
  }

  async function sendCommand(rawText?: string) {
    const text = (rawText ?? input).trim()
    if (!text || !supabase || !shopId || busy) return
    setInput('')
    addMessage({ role: 'user', text })
    setBusy(true)
    try {
      let interpreted: ReturnType<typeof fallbackInterpretation>
      const { data, error } = await supabase.functions.invoke('interpret-command', {
        body: { text, product_names: products.map(p => p.name) },
      })
      if (error || !data || typeof data.intent !== 'string') {
        interpreted = fallbackInterpretation(text)
        if (interpreted.intent === 'unknown') {
          addMessage({ role: 'assistant', text: 'The AI interpreter is not configured or is temporarily unavailable. I could not safely resolve that request. You can still use the inventory and sales screens, or try an exact product name with a supported command.' })
          return
        }
        addMessage({ role: 'assistant', text: 'AI interpretation is unavailable, so I used limited exact-name matching. Please review the result carefully.' })
      } else {
        interpreted = data
      }

      if (interpreted.intent === 'record_sale') {
        const lines: SaleLine[] = []
        for (const item of interpreted.items) {
          const product = resolveProduct(item.product_name)
          if (!product) {
            addMessage({ role: 'assistant', text: 'I could not match “' + item.product_name + '” to a product in your catalogue. No stock was changed. Check Inventory or use the exact product name.' })
            return
          }
          if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000) {
            addMessage({ role: 'assistant', text: 'That quantity does not look valid. Nothing was recorded.' })
            return
          }
          const existing = lines.find(line => line.product_id === product.id)
          if (existing) existing.quantity += item.quantity
          else lines.push({ product_id: product.id, name: product.name, quantity: item.quantity, unit_price_kobo: Number(product.selling_price_kobo), unit_cost_kobo: Number(product.unit_cost_kobo) })
        }
        if (!lines.length) {
          addMessage({ role: 'assistant', text: interpreted.clarifying_question || 'Which product and quantity did you sell? No changes have been made.' })
          return
        }
        const shortage = lines.find(line => {
          const product = products.find(p => p.id === line.product_id)
          return !product || product.stock_quantity < line.quantity
        })
        if (shortage) {
          addMessage({ role: 'assistant', text: 'I cannot prepare this sale: there are not enough units of ' + shortage.name + ' in recorded stock. Nothing has been recorded.' })
          return
        }
        const draft: SaleDraft = { items: lines, total_kobo: lines.reduce((sum, line) => sum + line.quantity * line.unit_price_kobo, 0), idempotency_key: uid() }
        addMessage({ role: 'assistant', text: 'Please review the sale below. Stock will only change after you confirm.', draft })
        return
      }
      if (interpreted.intent === 'check_stock') {
        const selected = interpreted.items.map(item => resolveProduct(item.product_name)).filter((p): p is Product => Boolean(p))
        if (!selected.length) {
          addMessage({ role: 'assistant', text: 'Which item should I check? Current catalogue: ' + products.map(p => p.name).join(', ') + '.' })
        } else {
          addMessage({ role: 'assistant', text: selected.map(p => p.name + ': ' + p.stock_quantity + ' units recorded, ' + money(Number(p.selling_price_kobo)) + ' each' + (p.stock_quantity <= p.low_stock_threshold ? ' — at or below the restock threshold.' : '.')).join('\n') })
        }
        return
      }
      if (interpreted.intent === 'business_summary') {
        const sum = todaySales.reduce((n, sale) => n + Number(sale.total_kobo), 0)
        addMessage({ role: 'assistant', text: 'Recorded sales for today: ' + money(sum) + '\nCompleted transactions: ' + todaySales.length + '\n\nGross profit requires the recorded item-level cost snapshots. This summary currently reports revenue only; it is not net profit.' })
        return
      }
      if (interpreted.intent === 'restock_advice') {
        addMessage({ role: 'assistant', text: lowStock.length ? 'Items at or below their configured threshold:\n' + lowStock.map(p => '• ' + p.name + ': ' + p.stock_quantity + ' left (threshold ' + p.low_stock_threshold + ')').join('\n') + '\n\nThese are threshold alerts, not a demand forecast.' : 'No active products are at or below their configured stock thresholds.' })
        return
      }
      if (interpreted.intent === 'cancel_reservation' || interpreted.intent === 'reserve_item') {
        addMessage({ role: 'assistant', text: 'Customer reservations are not yet enabled in this live workspace. I have not created or cancelled a reservation.' })
        return
      }
      addMessage({ role: 'assistant', text: interpreted.clarifying_question || 'I’m not sure what you want me to do. Try a stock check, a restock review, or a sale with exact product names.' })
    } catch (error) {
      addMessage({ role: 'assistant', text: error instanceof Error ? error.message : 'I could not process that request. No transaction was recorded.' })
    } finally {
      setBusy(false)
    }
  }

  async function confirmSale(draft: SaleDraft) {
    if (!supabase || !shopId || busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('record_sale', {
        p_shop_id: shopId,
        p_items: draft.items.map(line => ({ product_id: line.product_id, quantity: line.quantity })),
        p_idempotency_key: draft.idempotency_key,
        p_source: 'web',
      })
      if (error) throw error
      const result = data as { sale_id?: string; total_kobo?: number; duplicate?: boolean }
      if (!result?.sale_id) throw new Error('The database did not confirm the sale.')
      setMessages(prev => prev.map(m => m.draft?.idempotency_key === draft.idempotency_key
        ? { ...m, draft: undefined, text: 'Sale recorded in Supabase. Total: ' + money(Number(result.total_kobo ?? draft.total_kobo)) + (result.duplicate ? ' (safe retry; no duplicate stock deduction).' : '') }
        : m))
      addMessage({ role: 'assistant', text: 'Database confirmed the sale. I’m refreshing your stock and sales totals.' })
      await loadWorkspace(session!.user.id)
    } catch (error) {
      addMessage({ role: 'assistant', text: 'Sale was not confirmed by the database: ' + (error instanceof Error ? error.message : 'unknown error') + '. Check the inventory and try again; do not assume it was recorded.' })
    } finally {
      setBusy(false)
    }
  }

  async function addProduct(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !shopId) return
    const price = Number(productForm.price)
    const cost = Number(productForm.cost)
    const stock = Number(productForm.stock)
    const threshold = Number(productForm.threshold)
    if (!productForm.name.trim() || !Number.isFinite(price) || !Number.isFinite(cost) || price < 0 || cost < 0 || !Number.isInteger(stock) || stock < 0 || !Number.isInteger(threshold) || threshold < 0) {
      setNotice('Enter a product name, valid prices, and non-negative whole-number stock values.')
      return
    }
    setBusy(true)
    try {
      const name = productForm.name.trim()
      const { error } = await supabase.from('products').insert({
        shop_id: shopId, name, normalized_name: name.toLowerCase(), category: productForm.category.trim() || 'General',
        selling_price_kobo: Math.round(price * 100), unit_cost_kobo: Math.round(cost * 100),
        stock_quantity: stock, low_stock_threshold: threshold, is_active: true,
      })
      if (error) throw error
      setProductForm({ name: '', category: 'General', price: '', cost: '', stock: '', threshold: '5' })
      await loadWorkspace(session!.user.id)
      setNotice('Product added.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add product.')
    } finally {
      setBusy(false)
    }
  }

  async function restock(product: Product) {
    if (!supabase || !shopId) return
    const quantity = Number(restockValues[product.id])
    if (!Number.isInteger(quantity) || quantity < 1) { setNotice('Enter a positive whole number to restock.'); return }
    setBusy(true)
    try {
      const { error } = await supabase.rpc('adjust_stock', { p_shop_id: shopId, p_product_id: product.id, p_quantity_delta: quantity, p_note: 'Restock from inventory screen' })
      if (error) throw error
      setRestockValues(prev => ({ ...prev, [product.id]: '' }))
      await loadWorkspace(session!.user.id)
      setNotice('Stock updated and movement recorded.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update stock.')
    } finally {
      setBusy(false)
    }
  }

  if (!authReady) return <div className="live-auth-wrap"><div className="live-panel live-auth">Loading SabiShop…</div></div>
  if (!supabase) return <div className="live-auth-wrap"><div className="live-panel live-auth"><h1>SabiShop needs configuration</h1><p>Supabase client configuration is missing. Set the public project URL and publishable key.</p></div></div>
  if (!session) return <div className="live-auth-wrap"><section className="live-panel live-auth">
    <div className="live-brand"><div className="live-brand-mark">S</div><div><strong>sabi<span>shop</span></strong><small>YOUR SHOP, IN CONTROL</small></div></div>
    <h1>{authMode === 'signin' ? 'Welcome back.' : 'Set up your shop.'}</h1>
    <p>Record sales, keep stock accurate, and ask your assistant about the business. Your records are private to your signed-in shop team.</p>
    <form onSubmit={submitAuth}>
      {authMode === 'signup' && <div className="live-field"><label>Shop name</label><input className="live-input" value={shopName} onChange={e => setShopName(e.target.value)} required minLength={2} maxLength={100} /></div>}
      <div className="live-field"><label>Email address</label><input className="live-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></div>
      <div className="live-field"><label>Password (at least 8 characters)</label><input className="live-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} /></div>
      {authError && <div className="live-alert">{authError}</div>}
      <button className="live-primary" disabled={busy}>{busy ? 'Please wait…' : authMode === 'signin' ? 'Sign in securely' : 'Create account'}</button>
    </form>
    <p className="live-muted">{authMode === 'signin' ? 'New to SabiShop?' : 'Already have an account?'} <button className="live-secondary" onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setAuthError('') }}>{authMode === 'signin' ? 'Create an account' : 'Sign in'}</button></p>
    <p className="live-muted">Sample stock is labelled when first loaded. Replace it with verified quantities before using the app for real transactions.</p>
  </section></div>

  return <div className="live-shell">
    <aside className="live-sidebar">
      <div className="live-brand"><div className="live-brand-mark">S</div><div><strong>sabi<span>shop</span></strong><small>YOUR SHOP, IN CONTROL</small></div></div>
      <div className="live-shop"><div className="live-shop-icon">▦</div><div><strong>{shopTitle || 'Your shop'}</strong><small>Private retailer workspace</small></div></div>
      <div className="live-nav-label">WORKSPACE</div>
      <button className={'live-nav ' + (tab === 'assistant' ? 'active' : '')} onClick={() => setTab('assistant')}>✦ Assistant</button>
      <button className={'live-nav ' + (tab === 'inventory' ? 'active' : '')} onClick={() => setTab('inventory')}>▦ Inventory <span className="count">{products.length}</span></button>
      <button className={'live-nav ' + (tab === 'sales' ? 'active' : '')} onClick={() => setTab('sales')}>↗ Sales history</button>
      <div className="live-side-foot">LIVE SUPABASE WORKSPACE<br/>Your transactions are stored in the database. AI suggestions never update stock without confirmation.</div>
      <button className="live-nav" onClick={signOut}>↪ Sign out</button>
    </aside>
    <main className="live-main">
      <header className="live-topbar"><div className="live-crumb">Workspace / <strong>{tab === 'assistant' ? 'Assistant' : tab === 'inventory' ? 'Inventory' : 'Sales history'}</strong></div><span className="live-status">● CONNECTED TO DATABASE</span></header>
      <div className="live-content">
        <div className="live-heading"><div><div className="live-eyebrow">YOUR SHOP AT A GLANCE</div><h1>{tab === 'assistant' ? 'Sabi assistant' : tab === 'inventory' ? 'Inventory' : 'Sales history'}</h1><p>{tab === 'assistant' ? 'Talk naturally. Check the interpretation before committing a transaction.' : tab === 'inventory' ? 'Manage product prices, recorded stock, and restock movements.' : 'A record of completed sales committed to your database.'}</p></div>{tab === 'assistant' && <button className="live-secondary" onClick={() => void loadWorkspace(session.user.id)}>↻ Refresh data</button>}</div>
        {tab === 'assistant' && <div className="live-chat-layout">
          <section className="live-panel live-chat">
            <div className="live-chat-head"><div className="live-avatar">✦</div><div><strong>Sabi · shop assistant</strong><small>{loading ? 'Loading shop data…' : 'Ready · sale confirmation required'}</small></div><span className="live-pill">AI + verified records</span></div>
            <div className="live-messages">
              {messages.map(message => <div key={message.id} className={'live-msg ' + (message.role === 'user' ? 'user' : '')}>{message.text}{message.draft && <div className="live-draft">
                {message.draft.items.map(line => <div className="live-draft-row" key={line.product_id}><span>{line.quantity} × {line.name} · {money(line.unit_price_kobo)} each</span><strong>{money(line.quantity * line.unit_price_kobo)}</strong></div>)}
                <div className="live-draft-total"><span>Total sale value</span><span>{money(message.draft.total_kobo)}</span></div>
                <p className="live-muted">Stock is updated only after database confirmation.</p>
                <button className="live-primary" disabled={busy} onClick={() => void confirmSale(message.draft!)}>{busy ? 'Saving…' : 'Confirm and record sale'}</button>
              </div>}<small>{message.role === 'user' ? 'YOU' : 'SABI'}</small></div>)}
              {busy && <div className="live-msg">Working…<small>SABI</small></div>}
            </div>
            <div className="live-composer"><form onSubmit={e => { e.preventDefault(); void sendCommand() }}><input value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. I sold 3 Indomie Chicken…" aria-label="Message Sabi" /><button className="live-primary" disabled={busy || !input.trim()}>Send</button></form>
              <div className="live-hints"><button onClick={() => void sendCommand('I sold 3 Indomie Chicken and 2 Milo Sachet')}>Record a sale</button><button onClick={() => void sendCommand('What should I restock?')}>Restock advice</button><button onClick={() => void sendCommand('Do you have Peak Milk Sachet?')}>Check stock</button><button onClick={() => void sendCommand('How much did I sell today?')}>Today’s sales</button></div>
            </div>
          </section>
          <aside className="live-insights">
            <div className="live-panel live-stat"><small>SALES RECORDED TODAY</small><strong>{money(todayRevenue)}</strong><p>{todaySales.length} completed transactions</p></div>
            <div className="live-panel live-stat"><small>STOCK NEEDS ATTENTION</small><strong>{lowStock.length}</strong><p>At or below configured threshold</p></div>
            <div className="live-panel live-list"><h3>Stock alerts</h3>{lowStock.length ? lowStock.slice(0, 6).map(p => <div className="live-product" key={p.id}><span className="live-product-icon">▦</span><div><strong>{p.name}</strong><small>Threshold {p.low_stock_threshold}</small></div><span className="stock low">{p.stock_quantity}</span></div>) : <div className="live-empty">No products need attention.</div>}<button className="live-secondary" onClick={() => setTab('inventory')}>Open inventory</button></div>
          </aside>
        </div>}
        {tab === 'inventory' && <div className="live-panel">
          <div style={{ padding: 20, borderBottom: '1px solid #edf0eb' }}><h3 style={{ margin: '0 0 6px', fontSize: 14 }}>Add a product</h3><p className="live-muted">Prices are in naira. Stock movements are stored as separate audit records.</p>
            <form onSubmit={addProduct} className="live-form-grid">
              <div className="live-field"><label>Product name</label><input value={productForm.name} onChange={e => setProductForm(p => ({ ...p, name: e.target.value }))} required /></div>
              <div className="live-field"><label>Category</label><input value={productForm.category} onChange={e => setProductForm(p => ({ ...p, category: e.target.value }))} /></div>
              <div className="live-field"><label>Selling price (₦)</label><input type="number" min="0" step="0.01" value={productForm.price} onChange={e => setProductForm(p => ({ ...p, price: e.target.value }))} required /></div>
              <div className="live-field"><label>Unit cost (₦)</label><input type="number" min="0" step="0.01" value={productForm.cost} onChange={e => setProductForm(p => ({ ...p, cost: e.target.value }))} required /></div>
              <div className="live-field"><label>Opening stock</label><input type="number" min="0" step="1" value={productForm.stock} onChange={e => setProductForm(p => ({ ...p, stock: e.target.value }))} required /></div>
              <div className="live-field"><label>Low-stock threshold</label><input type="number" min="0" step="1" value={productForm.threshold} onChange={e => setProductForm(p => ({ ...p, threshold: e.target.value }))} required /></div>
              <div><button className="live-primary" disabled={busy}>Add product</button></div>
            </form>
          </div>
          <div className="live-table-wrap"><table className="live-table"><thead><tr><th>PRODUCT</th><th>SELLING PRICE</th><th>UNIT COST</th><th>STOCK</th><th>STATUS</th><th>RESTOCK</th></tr></thead><tbody>
            {products.map(p => <tr key={p.id}><td><strong>{p.name}</strong><br/><span className="live-muted">{p.category}</span></td><td>{money(Number(p.selling_price_kobo))}</td><td>{money(Number(p.unit_cost_kobo))}</td><td><strong>{p.stock_quantity}</strong></td><td><span className={'live-tag ' + (p.stock_quantity <= p.low_stock_threshold ? 'warn' : '')}>{p.stock_quantity <= p.low_stock_threshold ? 'Restock soon' : 'In stock'}</span></td><td><div style={{ display: 'flex', gap: 6 }}><input aria-label={'Restock quantity for ' + p.name} style={{ width: 70, padding: 7, border: '1px solid #dfe6dd', borderRadius: 7 }} type="number" min="1" step="1" value={restockValues[p.id] ?? ''} onChange={e => setRestockValues(v => ({ ...v, [p.id]: e.target.value }))}/><button className="live-secondary" disabled={busy} onClick={() => void restock(p)}>Add</button></div></td></tr>)}
            {!products.length && <tr><td colSpan={6}>No products yet.</td></tr>}
          </tbody></table></div>
        </div>}
        {tab === 'sales' && <div className="live-panel"><div className="live-table-wrap"><table className="live-table"><thead><tr><th>DATE & TIME</th><th>SALE ID</th><th>RECORDED REVENUE</th><th>STATUS</th></tr></thead><tbody>
          {sales.map(s => <tr key={s.id}><td>{new Date(s.created_at).toLocaleString('en-NG')}</td><td>{s.id.slice(0, 8).toUpperCase()}</td><td><strong>{money(Number(s.total_kobo))}</strong></td><td><span className="live-tag">Completed</span></td></tr>)}
          {!sales.length && <tr><td colSpan={4} className="live-empty">No sales recorded yet. Use Sabi assistant to prepare your first sale.</td></tr>}
        </tbody></table></div></div>}
      </div>
      <footer className="live-footer"><span>© 2026 SabiShop · Built for everyday retail</span><span>Sales commit atomically · Currency stored as integer kobo</span></footer>
    </main>
    {notice && <div style={{ position: 'fixed', bottom: 20, right: 20, maxWidth: 420, background: '#173e2b', color: '#fff', padding: '13px 17px', borderRadius: 12, fontSize: 12, boxShadow: '0 12px 35px #17231d30', zIndex: 10 }}><span>{notice}</span><button onClick={() => setNotice('')} style={{ marginLeft: 12, background: 'transparent', border: 0, color: '#fff' }}>×</button></div>}
  </div>
}