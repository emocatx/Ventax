export type Role = 'dueno' | 'encargado' | 'cajero';
export type Unit = 'pieza' | 'kg' | 'g' | 'l';
export type Level = 'ok' | 'aviso' | 'critico';
export type Method = 'efectivo' | 'tarjeta' | 'transferencia';

export interface Employee { id: number; name: string; role: Role; shift_def_id: number | null; active: number; perms?: string[] }
export interface ShiftDef { id: number; name: string; start: string; end: string; position: number }
export interface Shift {
  id: number; cashier: string; employee_id: number | null; shift_def_id: number | null; opened_at: string; opening_float: number;
  status: 'open' | 'closed'; shift_name: string | null; shift_end: string | null; overdue_minutes: number;
}
export interface Settings {
  business_name: string; giro: string; open_hours: string; configured: string; shifts_enabled: string;
  encargado_enabled: string; encargado_perms: string; backup_dir: string;
}
export interface Giro { label: string; categories: string[] }
export interface Product {
  id: number; barcode: string | null; name: string; category: string; cost?: number; price: number; stock: number;
  min_stock: number; max_stock: number; unit: Unit; image: string; expires_at: string | null; tax_rate: number; active: number; level: Level;
}
export interface CartLine { product: Product; qty: number }
export interface Discount { type: 'pct' | 'amount'; value: number; reason: string }
export interface SaleItem { id: number; name: string; qty: number; price: number; returned: number }
export interface Sale {
  id: number; created_at: string; total: number; subtotal: number; tax: number; discount: number; method: Method;
  cash_received: number | null; change_given: number | null; cashier: string; business: string; items: SaleItem[];
}
export interface PublicInfo {
  needs_setup: boolean; business_name: string; giros: Record<string, Giro>; employees: Employee[]; shift_defs: ShiftDef[]; shifts_enabled: boolean;
}
export interface StateResponse {
  settings: Settings; giros: Record<string, Giro>; shift_defs: ShiftDef[]; shift: Shift | null; user: Employee & { perms: string[] }; encargado_perms: string[];
}
