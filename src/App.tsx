import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Menu, X, Sun, Moon, MessageSquare, Package, History, LogOut } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import './live.css'
import PublicStorefront from './PublicStorefront'

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
type ChatMessage = { id: string; role: 'assistant' | 'user'; text: string; draft?: SaleDraft; created_at?: string }
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
function looksLikePidgin(text: string) {
  return /\b(abeg|wettin|wetin|dey|don|una|na|sef|make i|how far|no wahala|e be like)\b/i.test(text)
}

type InterpretedCommand = {
  intent: string
  items: { product_name: string; quantity: number }[]
  confidence: number
  needs_confirmation: boolean
  clarifying_question: string
  response_language: 'english' | 'pidgin'
  valuation_basis: 'cost' | 'retail' | 'both' | 'none'
}

function fallbackInterpretCommand(text: string, products: Product[]): InterpretedCommand {
  const pidgin = looksLikePidgin(text)
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12 }
  const mentions = products.map(product => {
    const name = product.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    const tokens = name.split(' ').filter(token => token.length > 2)
    const phrase = normalized.includes(name) ? name : tokens.find(token => normalized.split(' ').includes(token))
    return phrase ? { product, phrase, exact: normalized.includes(name) } : null
  }).filter((entry): entry is { product: Product; phrase: string; exact: boolean } => Boolean(entry))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.phrase.length - a.phrase.length)
  const exactMentions = mentions.filter(entry => entry.exact)
  const mentionCandidates = exactMentions.length ? exactMentions : mentions.filter(entry => !['sachet', '500g', '75cl', 'cl', 'gram', 'grams'].includes(entry.phrase))
  const mentioned = mentionCandidates.filter((entry, index, all) => all.findIndex(other => other.product.id === entry.product.id) === index)
  const makeResult = (intent: string, items: { product_name: string; quantity: number }[] = [], valuation_basis: InterpretedCommand['valuation_basis'] = 'none', clarifying_question = ''): InterpretedCommand => ({
    intent, items, confidence: 0.72, needs_confirmation: intent === 'record_sale',
    clarifying_question, response_language: pidgin ? 'pidgin' : 'english', valuation_basis,
  })
  if (/\b(capital|invested|investment|stock value|stock amount|total stock|inventory value)\b/.test(normalized)) {
    const basis = /\b(retail|selling price|sell all|sales value)\b/.test(normalized) ? 'retail' : /\b(capital|invested|investment)\b/.test(normalized) ? 'cost' : 'both'
    return makeResult('inventory_valuation', [], basis)
  }
  if (/\b(restock|re stock|what should i buy|what to buy|low stock|stock don low|wetin i go buy)\b/.test(normalized)) return makeResult('restock_advice')
  if (/\b(today|this week|revenue|sales summary|how much did i sell|how much we sell|business summary|sales today)\b/.test(normalized)) return makeResult('business_summary')
  if (/\b(wetin dey shop|what(?:'s| is) in (?:the )?shop|list (?:the )?products|show (?:the )?(?:catalogue|catalog|products)|shop catalogue|shop catalog)\b/.test(normalized)) return makeResult('shop_catalogue')
  if (/\b(stock|how many|quantity|available|do you have|have any|remain|left)\b/.test(normalized) && !/\b(restock|low stock)\b/.test(normalized)) {
    return mentioned.length
      ? makeResult('check_stock', mentioned.map(entry => ({ product_name: entry.product.name, quantity: 1 })))
      : makeResult('check_stock', [], 'none', pidgin ? 'Which item you want make I check? Mention the product name.' : 'Which item should I check? Please mention the product name.')
  }
  if (/\b(sold|sell|sale|don sell|i sell|i sold|customer buy|bought|purchase)\b/.test(normalized)) {
    const items = mentioned.map(entry => {
      const at = normalized.indexOf(entry.phrase)
      const before = normalized.slice(0, at).trim().split(' ')
      const token = before[before.length - 1]
      const quantity = /^\d+$/.test(token) ? Number(token) : words[token]
      return quantity ? { product_name: entry.product.name, quantity } : null
    }).filter((item): item is { product_name: string; quantity: number } => Boolean(item))
    if (items.length && items.length === mentioned.length) return makeResult('record_sale', items)
    return makeResult('unknown', [], 'none', pidgin
      ? 'I understand say na sale, but I need the exact product name and quantity before I prepare am.'
      : 'I understand this may be a sale, but I need each product name and quantity before preparing it.')
  }
  return makeResult('unknown', [], 'none', pidgin
    ? 'AI no dey available right now. Abeg tell me whether you want check stock, list products, see sales summary, or record a sale.'
    : 'The AI service is unavailable. Please specify whether you want to check stock, list products, see a sales summary, or prepare a sale.')
}
const greeting: ChatMessage[] = [{ id: 'welcome', role: 'assistant', text: 'Good afternoon. I’m Sabi, your shop assistant. Tell me what sold, ask about stock, or request a summary. I’ll check the details and ask before recording a sale.' }]

function RetailerApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [accountType, setAccountType] = useState<'retailer' | 'customer'>('retailer')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shopName, setShopName] = useState('Dio’s Provision Store')
  const [shopId, setShopId] = useState('')
  const [shopTitle, setShopTitle] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [tab, setTab] = useState<Tab>('assistant')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem('sabishop-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' } })
  const [messages, setMessages] = useState<ChatMessage[]>(greeting)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [authError, setAuthError] = useState('')
  const [productForm, setProductForm] = useState({ name: '', category: 'General', price: '', cost: '', stock: '', threshold: '5' })
  const [restockValues, setRestockValues] = useState<Record<string, string>>({})
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    document.documentElement.dataset.sabishopTheme = theme
    try { localStorage.setItem('sabishop-theme', theme) } catch { /* storage may be unavailable */ }
  }, [theme])

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user.user_metadata?.account_type === 'customer' && window.location.pathname !== '/storefront') { window.location.replace('/storefront'); return }
      setSession(data.session)
      setAuthReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession?.user.user_metadata?.account_type === 'customer' && window.location.pathname !== '/storefront') { window.location.replace('/storefront'); return }
      setSession(nextSession)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const container = messagesEndRef.current
    if (container) container.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy, tab, shopId])

  useEffect(() => {
    if (!session || !supabase) {
      setShopId('')
      setProducts([])
      setSales([])
      setMessages(greeting)
      return
    }
    void loadWorkspace(session.user.id)
  }, [session?.user.id])

  useEffect(() => {
    if (!session || !supabase || !shopId) return
    let cancelled = false
    async function loadChatHistory() {
      const { data, error } = await supabase!.from('chat_messages')
        .select('id, role, text, draft, created_at')
        .eq('shop_id', shopId)
        .eq('user_id', session!.user.id)
        .order('created_at', { ascending: false })
        .limit(200)
      if (cancelled) return
      if (error) {
        setNotice('Chat history could not be loaded: ' + error.message)
        return
      }
      if (data?.length) {
        setMessages([...(data as ChatMessage[])].reverse())
      } else {
        const welcome: ChatMessage = { id: uid(), role: 'assistant', text: greeting[0].text, created_at: new Date().toISOString() }
        setMessages([welcome])
        const { error: saveError } = await supabase!.from('chat_messages').insert({
          id: welcome.id, shop_id: shopId, user_id: session!.user.id,
          role: welcome.role, text: welcome.text, created_at: welcome.created_at,
        })
        if (saveError && !cancelled) setNotice('Chat history could not be saved: ' + saveError.message)
      }
    }
    void loadChatHistory()
    return () => { cancelled = true }
  }, [shopId, session?.user.id])

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
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { account_type: accountType, full_name: fullName.trim(), phone: phone.trim() } } })
        if (error) throw error
        if (!data.session) {
          setAuthError('Account created. Check your email for the confirmation link, then sign in.')
        } else {
          setNotice('Account created. Setting up your shop…')
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
        const signedInType = data.user.user_metadata?.account_type === 'customer' ? 'customer' : 'retailer'
        if (signedInType !== accountType) { await supabase.auth.signOut(); throw new Error('This account is registered as a ' + signedInType + '. Select the matching account type to sign in.') }
        if (signedInType === 'customer') window.location.replace('/storefront')
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

  function addMessage(message: Omit<ChatMessage, 'id' | 'created_at'>) {
    const next: ChatMessage = { ...message, id: uid(), created_at: new Date().toISOString() }
    setMessages(prev => [...prev, next])
    if (supabase && session && shopId) {
      void supabase.from('chat_messages').insert({
        id: next.id, shop_id: shopId, user_id: session.user.id,
        role: next.role, text: next.text, draft: next.draft ?? null, created_at: next.created_at,
      }).then(({ error }) => {
        if (error) setNotice('A chat message could not be saved: ' + error.message)
      })
    }
  }

  function resolveProduct(name: string): Product | undefined {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ')
    return products.find(p => p.normalized_name === normalized || p.name.toLowerCase() === normalized)
      ?? products.find(p => normalized.length > 2 && (p.normalized_name.includes(normalized) || normalized.includes(p.normalized_name)))
  }

  async function sendCommand(rawText?: string) {
    const text = (rawText ?? input).trim()
    if (!text || !supabase || !session || !shopId || busy) return
    setInput('')
    addMessage({ role: 'user', text })
    setBusy(true)
    try {
      const previousUserMessage = [...messages].reverse().find(message => message.role === 'user')
      // Only the immediately preceding assistant message can be a pending sale.
      // Do not let a stale draft from earlier in the chat intercept an unrelated command.
      const latestMessage = messages[messages.length - 1]
      const pendingDraftMessage = latestMessage?.role === 'assistant' && latestMessage.draft
        ? latestMessage
        : undefined
      const isCancelRequest = /^(cancel|cancel am|cancel that|abeg cancel|abeg cancel am|no|no cancel|forget am|forget that)$/i.test(text)
      if (isCancelRequest && pendingDraftMessage?.draft) {
        const pidgin = looksLikePidgin(text) || Boolean(previousUserMessage && looksLikePidgin(previousUserMessage.text))
        const cancelledText = pidgin
          ? 'I don cancel that sale draft. Stock no change, and I never record the sale.'
          : 'Sale draft cancelled. Stock was not changed and no sale was recorded.'
        // Preserve the original sale-preview text. Cancellation is a separate assistant reply.
        // Overwriting the preview made the transcript look as if the sale command was cancelled immediately.
        setMessages(prev => prev.map(message => message.id === pendingDraftMessage.id
          ? { ...message, draft: undefined }
          : message))
        const { error: cancelSaveError } = await supabase.from('chat_messages').update({ draft: null })
          .eq('id', pendingDraftMessage.id).eq('user_id', session.user.id)
        if (cancelSaveError) setNotice('The draft was cancelled in this session, but chat history could not be updated: ' + cancelSaveError.message)
        addMessage({ role: 'assistant', text: cancelledText })
        return
      }
      let interpreted: InterpretedCommand
      let usedFallback = false
      try {
        const { data, error } = await supabase.functions.invoke('interpret-command', {
          body: {
            text,
            product_names: products.map(p => p.name),
            conversation: messages.slice(-8).map(message => ({ role: message.role, text: message.text })),
          },
        })
        if (error) throw new Error(error.message || 'AI interpreter request failed')
        if (!data || typeof data.intent !== 'string' || !Array.isArray(data.items) || !['english', 'pidgin'].includes(data.response_language)) {
          throw new Error('AI interpreter returned an invalid structured result')
        }
        const candidate = data as InterpretedCommand
        const localCandidate = fallbackInterpretCommand(text, products)
        const invalidSale = candidate.intent === 'record_sale' && (!candidate.items.length || candidate.items.some(item =>
          !item || typeof item.product_name !== 'string' || !item.product_name.trim() ||
          !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000))
        const missedStockLookup = candidate.intent === 'check_stock' && !candidate.items.length &&
          localCandidate.intent === 'check_stock' && localCandidate.items.length > 0
        const missedSupportedIntent = candidate.intent === 'unknown' && localCandidate.intent !== 'unknown'
        if (invalidSale || missedStockLookup || missedSupportedIntent || candidate.confidence < 0.25) {
          throw new Error('AI interpretation was incomplete or too uncertain')
        }
        interpreted = candidate
      } catch (aiError) {
        console.warn('AI interpreter unavailable; trying deterministic fallback', aiError)
        interpreted = fallbackInterpretCommand(text, products)
        usedFallback = true
        setNotice('AI unavailable. Used local fallback for this command; please check the interpretation carefully.')
      }
      if (usedFallback && interpreted.intent === 'unknown') {
        addMessage({ role: 'assistant', text: interpreted.clarifying_question + '\n\nNo stock or sales records were changed.' })
        return
      }
      const pidgin = interpreted.response_language === 'pidgin'

      if (interpreted.intent === 'record_sale') {
        const lines: SaleLine[] = []
        for (const item of interpreted.items) {
          const product = resolveProduct(item.product_name)
          if (!product) {
            addMessage({ role: 'assistant', text: pidgin
              ? 'I no fit match “' + item.product_name + '” with any product for your catalogue. I never change stock. Check Inventory or use the exact product name.'
              : 'I could not match “' + item.product_name + '” to a product in your catalogue. No stock was changed. Check Inventory or use the exact product name.' })
            return
          }
          if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000) {
            addMessage({ role: 'assistant', text: pidgin ? 'That quantity no look correct. I never record anything.' : 'That quantity does not look valid. Nothing was recorded.' })
            return
          }
          const existing = lines.find(line => line.product_id === product.id)
          if (existing) existing.quantity += item.quantity
          else lines.push({ product_id: product.id, name: product.name, quantity: item.quantity, unit_price_kobo: Number(product.selling_price_kobo), unit_cost_kobo: Number(product.unit_cost_kobo) })
        }
        if (!lines.length) {
          addMessage({ role: 'assistant', text: interpreted.clarifying_question || (pidgin ? 'Which product you sell, and how many? I never change anything.' : 'Which product and quantity did you sell? No changes have been made.') })
          return
        }
        const shortage = lines.find(line => {
          const product = products.find(p => p.id === line.product_id)
          return !product || product.stock_quantity < line.quantity
        })
        if (shortage) {
          addMessage({ role: 'assistant', text: pidgin
            ? 'I no fit prepare this sale: ' + shortage.name + ' no reach for recorded stock. I never record anything.'
            : 'I cannot prepare this sale: there are not enough units of ' + shortage.name + ' in recorded stock. Nothing has been recorded.' })
          return
        }
        const draft: SaleDraft = { items: lines, total_kobo: lines.reduce((sum, line) => sum + line.quantity * line.unit_price_kobo, 0), idempotency_key: uid() }
        addMessage({ role: 'assistant', text: pidgin
          ? 'Abeg check this sale. Stock go change only after you confirm am.'
          : 'Please review the sale below. Stock will only change after you confirm.', draft })
        return
      }
      if (interpreted.intent === 'shop_catalogue') {
        addMessage({ role: 'assistant', text: products.length
          ? (pidgin ? 'Na wetin dey your recorded shop be this:\n' : 'Here is your recorded catalogue:\n') + products.map(p => '• ' + p.name + ': ' + p.stock_quantity + (pidgin ? ' dey stock at ' : ' units at ') + money(Number(p.selling_price_kobo)) + ' each').join('\n')
          : (pidgin ? 'No active product dey your catalogue yet. Add products for Inventory first.' : 'There are no active products in your catalogue yet. Add products in Inventory first.') })
        return
      }
      if (interpreted.intent === 'inventory_valuation') {
        const costValue = products.reduce((sum, product) => sum + Number(product.stock_quantity) * Number(product.unit_cost_kobo), 0)
        const retailValue = products.reduce((sum, product) => sum + Number(product.stock_quantity) * Number(product.selling_price_kobo), 0)
        const basis = interpreted.valuation_basis
        const reply = pidgin
          ? basis === 'cost'
            ? 'Your total capital wey dey inside current stock na ' + money(costValue) + '. Na the recorded cost value of stock wey remain; e no include other business expenses.'
            : basis === 'retail'
              ? 'If you sell all the stock wey remain at current prices, total sales value go be ' + money(retailValue) + '.'
              : 'The cost value of all stock wey remain na ' + money(costValue) + '. If you sell all of am at current prices, the total sales value go be ' + money(retailValue) + '.'
          : basis === 'cost'
            ? 'The recorded cost value of your current stock is ' + money(costValue) + '. This represents the inventory investment at recorded unit costs, not all business capital or expenses.'
            : basis === 'retail'
              ? 'If you sell all remaining stock at current prices, its total retail value is ' + money(retailValue) + '.'
              : 'The recorded cost value of all remaining stock is ' + money(costValue) + '. At current selling prices, its total retail value is ' + money(retailValue) + '.'
        addMessage({ role: 'assistant', text: reply })
        return
      }
      if (interpreted.intent === 'check_stock') {
        const selected = interpreted.items.map(item => resolveProduct(item.product_name)).filter((p): p is Product => Boolean(p))
        if (!selected.length) {
          addMessage({ role: 'assistant', text: interpreted.clarifying_question || (pidgin
            ? 'Which item you want make I check? Products wey dey catalogue be: ' + products.map(p => p.name).join(', ') + '.'
            : 'Which item should I check? Current catalogue: ' + products.map(p => p.name).join(', ') + '.') })
        } else {
          addMessage({ role: 'assistant', text: selected.map(p => pidgin
            ? p.name + ': ' + p.stock_quantity + ' dey stock, ' + money(Number(p.selling_price_kobo)) + ' each' + (p.stock_quantity <= p.low_stock_threshold ? ' — e don reach restock level.' : '.')
            : p.name + ': ' + p.stock_quantity + ' units recorded, ' + money(Number(p.selling_price_kobo)) + ' each' + (p.stock_quantity <= p.low_stock_threshold ? ' — at or below the restock threshold.' : '.')).join('\n') })
        }
        return
      }
      if (interpreted.intent === 'business_summary') {
        const sum = todaySales.reduce((n, sale) => n + Number(sale.total_kobo), 0)
        addMessage({ role: 'assistant', text: pidgin
          ? 'Sales wey system record today na ' + money(sum) + '.\nCompleted transactions: ' + todaySales.length + '.\n\nThis na revenue only, no be net profit. We need item-level cost records to calculate gross profit.'
          : 'Recorded sales for today: ' + money(sum) + '\nCompleted transactions: ' + todaySales.length + '\n\nGross profit requires the recorded item-level cost snapshots. This summary currently reports revenue only; it is not net profit.' })
        return
      }
      if (interpreted.intent === 'restock_advice') {
        addMessage({ role: 'assistant', text: lowStock.length
          ? (pidgin ? 'Products wey reach or pass their restock level be these:\n' : 'Items at or below their configured threshold:\n') + lowStock.map(p => '• ' + p.name + ': ' + p.stock_quantity + (pidgin ? ' remain (level ' : ' left (threshold ') + p.low_stock_threshold + ')').join('\n') + (pidgin ? '\n\nNa stock-threshold alert, no be demand forecast.' : '\n\nThese are threshold alerts, not a demand forecast.')
          : (pidgin ? 'No active product don reach their restock level.' : 'No active products are at or below their configured stock thresholds.') })
        return
      }
      if (interpreted.intent === 'cancel_reservation' || interpreted.intent === 'reserve_item') {
        addMessage({ role: 'assistant', text: pidgin
          ? 'Customer reservation never ready for this demo yet. I no create or cancel any reservation.'
          : 'Customer reservations are not yet enabled in this live workspace. I have not created or cancelled a reservation.' })
        return
      }
      addMessage({ role: 'assistant', text: interpreted.clarifying_question || (pidgin
        ? 'I no too understand wetin you want. You fit ask about stock, restock, today sales, total stock value, or tell me wetin you sell.'
        : 'I’m not sure what you want me to do. Try a stock check, a restock review, today’s sales, total stock value, or a sale with exact product names.') })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'I could not process that request.'
      addMessage({ role: 'assistant', text: looksLikePidgin(text)
        ? 'I no fit process that request. I never record any transaction. Details: ' + detail
        : detail + ' No transaction was recorded.' })
    } finally {
      setBusy(false)
    }
  }

  async function confirmSale(draft: SaleDraft) {
    if (!supabase || !shopId || busy) return
    const draftMessage = messages.find(m => m.draft?.idempotency_key === draft.idempotency_key)
    const pidgin = looksLikePidgin(draftMessage?.text ?? '')
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
      const recordedText = pidgin
        ? 'Sale don record for Supabase. Total: ' + money(Number(result.total_kobo ?? draft.total_kobo)) + (result.duplicate ? ' (safe retry; stock no deduct twice).' : '')
        : 'Sale recorded in Supabase. Total: ' + money(Number(result.total_kobo ?? draft.total_kobo)) + (result.duplicate ? ' (safe retry; no duplicate stock deduction).' : '')
      setMessages(prev => prev.map(m => m.draft?.idempotency_key === draft.idempotency_key
        ? { ...m, draft: undefined, text: recordedText }
        : m))
      if (draftMessage && supabase && session) {
        const { error: chatUpdateError } = await supabase.from('chat_messages')
          .update({ text: recordedText, draft: null })
          .eq('id', draftMessage.id).eq('user_id', session.user.id)
        if (chatUpdateError) setNotice('Sale recorded, but chat history update failed: ' + chatUpdateError.message)
      }
      addMessage({ role: 'assistant', text: pidgin
        ? 'Database don confirm the sale. I dey refresh your stock and sales total.'
        : 'Database confirmed the sale. I’m refreshing your stock and sales totals.' })
      await loadWorkspace(session!.user.id)
    } catch (error) {
      addMessage({ role: 'assistant', text: pidgin
        ? 'Database never confirm the sale: ' + (error instanceof Error ? error.message : 'unknown error') + '. Check your stock and try again; no assume say e don record.'
        : 'Sale was not confirmed by the database: ' + (error instanceof Error ? error.message : 'unknown error') + '. Check the inventory and try again; do not assume it was recorded.' })
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
    <h1>{authMode === 'signin' ? 'Welcome back.' : accountType === 'retailer' ? 'Set up your shop.' : 'Create your customer account.'}</h1>
    <p>{accountType === 'retailer' ? 'Manage stock, record sales, and use your private shop assistant.' : 'Find local shops, reserve products, and manage your reservations.'}</p>
    <div className="live-account-type" role="group" aria-label="Choose account type"><button type="button" className={accountType === 'retailer' ? 'selected' : ''} onClick={() => { setAccountType('retailer'); setAuthError('') }}>Retailer</button><button type="button" className={accountType === 'customer' ? 'selected' : ''} onClick={() => { setAccountType('customer'); setAuthError('') }}>Customer</button></div>
    <form onSubmit={submitAuth}>
      {authMode === 'signup' && <div className="live-field"><label>{accountType === 'retailer' ? 'Shop name' : 'Full name'}</label><input className="live-input" value={accountType === 'retailer' ? shopName : fullName} onChange={e => accountType === 'retailer' ? setShopName(e.target.value) : setFullName(e.target.value)} required minLength={2} maxLength={100} /></div>}
      {authMode === 'signup' && accountType === 'customer' && <div className="live-field"><label>Phone number</label><input className="live-input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required maxLength={40} autoComplete="tel" /></div>}
      <div className="live-field"><label>Email address</label><input className="live-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></div>
      <div className="live-field"><label>Password (at least 8 characters)</label><input className="live-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} /></div>
      {authError && <div className="live-alert">{authError}</div>}
      <button className="live-primary" disabled={busy}>{busy ? 'Please wait…' : authMode === 'signin' ? 'Sign in securely' : 'Create account'}</button>
    </form>
    <p className="live-muted">{authMode === 'signin' ? 'New to SabiShop?' : 'Already have an account?'} <button className="live-secondary" onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setAuthError('') }}>{authMode === 'signin' ? 'Create an account' : 'Sign in'}</button></p>
    <p className="live-muted">Sample stock is labelled when first loaded. Replace it with verified quantities before using the app for real transactions.</p>
  </section></div>

  return <div className="live-shell" data-theme={theme}>
    {mobileMenuOpen && <button className="live-mobile-scrim" aria-label="Close navigation menu" onClick={() => setMobileMenuOpen(false)} />}
    <aside className={'live-sidebar ' + (mobileMenuOpen ? 'mobile-open' : '')}>
      <div className="live-brand"><div className="live-brand-mark">S</div><div><strong>sabi<span>shop</span></strong><small>YOUR SHOP, IN CONTROL</small></div></div>
      <div className="live-shop"><div className="live-shop-icon">▦</div><div><strong>{shopTitle || 'Your shop'}</strong><small>Private retailer workspace</small></div></div>
      <div className="live-nav-label">WORKSPACE</div>
      <button className={'live-nav ' + (tab === 'assistant' ? 'active' : '')} onClick={() => { setTab('assistant'); setMobileMenuOpen(false) }}><MessageSquare size={17} /> Assistant</button>
      <button className={'live-nav ' + (tab === 'inventory' ? 'active' : '')} onClick={() => { setTab('inventory'); setMobileMenuOpen(false) }}><Package size={17} /> Inventory <span className="count">{products.length}</span></button>
      <button className={'live-nav ' + (tab === 'sales' ? 'active' : '')} onClick={() => { setTab('sales'); setMobileMenuOpen(false) }}><History size={17} /> Sales history</button>
      <div className="live-side-foot">LIVE SUPABASE WORKSPACE<br/>Your transactions are stored in the database. AI suggestions never update stock without confirmation.</div>
      <button className="live-nav" onClick={() => { setMobileMenuOpen(false); void signOut() }}><LogOut size={17} /> Sign out</button>
    </aside>
    <main className="live-main">
      <header className="live-topbar">
        <button className="live-menu-button" aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(open => !open)}>{mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <div className="live-crumb">Workspace / <strong>{tab === 'assistant' ? 'Assistant' : tab === 'inventory' ? 'Inventory' : 'Sales history'}</strong></div>
        <div className="live-topbar-actions"><button className="live-theme-toggle" onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Enable dark mode' : 'Enable light mode'} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}<span>{theme === 'light' ? 'Dark' : 'Light'}</span></button><span className="live-status">● CONNECTED TO DATABASE</span></div>
      </header>
      <div className="live-content">
        <div className="live-heading"><div><div className="live-eyebrow">YOUR SHOP AT A GLANCE</div><h1>{tab === 'assistant' ? 'Sabi assistant' : tab === 'inventory' ? 'Inventory' : 'Sales history'}</h1><p>{tab === 'assistant' ? 'Talk naturally. Check the interpretation before committing a transaction.' : tab === 'inventory' ? 'Manage product prices, recorded stock, and restock movements.' : 'A record of completed sales committed to your database.'}</p></div>{tab === 'assistant' && <button className="live-secondary" onClick={() => void loadWorkspace(session.user.id)}>↻ Refresh data</button>}</div>
        {tab === 'assistant' && <div className="live-chat-layout">
          <section className="live-panel live-chat">
            <div className="live-chat-head"><div className="live-avatar">✦</div><div><strong>Sabi · shop assistant</strong><small>{loading ? 'Loading shop data…' : 'Ready · sale confirmation required'}</small></div><span className="live-pill">AI + verified records</span></div>
            <div className="live-messages">
              {messages.map(message => <div key={message.id} className={'live-msg ' + (message.role === 'user' ? 'user' : '')}>{message.text}{message.draft && <div className="live-draft">
                {message.draft.items.map(line => <div className="live-draft-row" key={line.product_id}><span>{line.quantity} × {line.name} · {money(line.unit_price_kobo)} each</span><strong>{money(line.quantity * line.unit_price_kobo)}</strong></div>)}
                <div className="live-draft-total"><span>Total sale value</span><span>{money(message.draft.total_kobo)}</span></div>
                <p className="live-muted">{looksLikePidgin(message.text) ? 'Stock go change only after database confirmation.' : 'Stock is updated only after database confirmation.'}</p>
                <button className="live-primary" disabled={busy} onClick={() => void confirmSale(message.draft!)}>{busy ? (looksLikePidgin(message.text) ? 'I dey save…' : 'Saving…') : (looksLikePidgin(message.text) ? 'Confirm am and record sale' : 'Confirm and record sale')}</button>
              </div>}<small className="live-msg-meta"><span>{message.role === 'user' ? 'YOU' : 'SABI'}</span><time dateTime={message.created_at ?? new Date().toISOString()}>{new Intl.DateTimeFormat('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(message.created_at ?? Date.now()))}</time></small></div>)}
              {busy && <div className="live-msg">{looksLikePidgin(messages.filter(message => message.role === 'user').slice(-1)[0]?.text ?? '') ? 'I dey work…' : 'Working…'}<small>SABI</small></div>}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
            <div className="live-composer"><form onSubmit={e => { e.preventDefault(); void sendCommand() }}><input value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. I sold 3 Indomie / Abeg, how many remain?" aria-label="Message Sabi" /><button className="live-primary" disabled={busy || !input.trim()}>Send</button></form>
              <div className="live-hints"><button onClick={() => void sendCommand('I sold 3 Indomie Chicken and 2 Milo Sachet')}>Record a sale</button><button onClick={() => void sendCommand('What should I restock?')}>Restock advice</button><button onClick={() => void sendCommand('Do you have Peak Milk Sachet?')}>Check stock</button><button onClick={() => void sendCommand('Abeg, how many Indomie Chicken remain?')}>Try Pidgin</button><button onClick={() => void sendCommand('How much did I sell today?')}>Today’s sales</button></div>
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

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/storefront' || path === '/marketplace') return <PublicStorefront />
  return <RetailerApp />
}
