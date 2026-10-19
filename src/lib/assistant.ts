import { supabase } from './supabase'

export type CommandIntent =
  | 'record_sale'
  | 'check_stock'
  | 'business_summary'
  | 'restock_advice'
  | 'reserve_item'
  | 'cancel_reservation'
  | 'unknown'

export type InterpretedItem = {
  product_name: string
  quantity: number
}

export type InterpretedCommand = {
  intent: CommandIntent
  items: InterpretedItem[]
  confidence: number
  needs_confirmation: boolean
  clarifying_question: string
  source: string
}

export async function interpretCommand(text: string, productNames: string[]): Promise<InterpretedCommand> {
  if (!supabase) {
    throw new Error('Supabase is not configured. The demo currently uses local sample data.')
  }

  const { data, error } = await supabase.functions.invoke('interpret-command', {
    body: { text, product_names: productNames },
  })

  if (error) throw new Error('Could not interpret the request. Please try again.')
  if (!data || typeof data.intent !== 'string' || !Array.isArray(data.items)) {
    throw new Error('The assistant returned an invalid response.')
  }

  return data as InterpretedCommand
}