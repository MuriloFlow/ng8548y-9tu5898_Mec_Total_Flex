export type Role = "admin" | "attendant" | "mechanic";

export type OrderStatus =
  | "draft"
  | "waiting_approval"
  | "approved"
  | "in_service"
  | "waiting_parts"
  | "finished"
  | "delivered"
  | "cancelled";

export type PaymentStatus = "unpaid" | "partial" | "paid" | "refunded" | "cancelled";
export type PaymentMethod = "pix" | "cash" | "debit" | "credit" | "transfer" | "other";
export type Priority = "low" | "normal" | "high" | "urgent";
export type InspectionStatus = "ok" | "attention" | "damaged" | "not_applicable";
export type QuoteStatus = "draft" | "sent" | "approved" | "rejected" | "expired";
export type DocumentType = "service_order" | "quote" | "receipt" | "fiscal_receipt";
export type DocumentStatus = "draft" | "generated" | "cancelled";
export type CatalogStatus = "active" | "inactive";
export type AuditAction =
  | "created"
  | "updated"
  | "approved"
  | "cancelled"
  | "payment_received"
  | "document_generated"
  | "status_changed"
  | "synced";

export type VehicleLookupStatus = "not_started" | "found" | "not_found" | "unavailable" | "manual";

export type AppUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  employeeId?: string;
  createdAt: string;
};

export type Employee = {
  id: string;
  name: string;
  role: Role;
  phone?: string;
  email?: string;
  active: boolean;
  createdAt: string;
};

export type Customer = {
  id: string;
  cpf: string;
  name: string;
  phone: string;
  email?: string;
  noEmail: boolean;
  address?: string;
  district?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type MileageRecord = {
  id: string;
  vehicleId: string;
  orderId?: string;
  mileage: number;
  recordedAt: string;
};

export type Vehicle = {
  id: string;
  customerId: string;
  plate: string;
  brand: string;
  model: string;
  version?: string;
  year?: number;
  color?: string;
  category: "car" | "motorcycle" | "truck" | "van" | "other";
  lookupStatus: VehicleLookupStatus;
  lookupProvider?: string;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

/** Memória anônima de placa — sobrevive à exclusão do cliente para reconhecimento futuro. */
export type PlateMemory = {
  id: string;
  plate: string;
  brand: string;
  model: string;
  version?: string;
  year?: number;
  color?: string;
  category: Vehicle["category"];
  lookupStatus?: VehicleLookupStatus;
  lookupProvider?: string;
  imageUrl?: string;
  updatedAt: string;
};

export type CatalogService = {
  id: string;
  name: string;
  description?: string;
  internalCode?: string;
  defaultPrice: number;
  defaultLabor: number;
  cost: number;
  estimatedMinutes: number;
  category: string;
  status: CatalogStatus;
  createdAt: string;
  updatedAt: string;
};

export type CatalogProduct = {
  id: string;
  name: string;
  description?: string;
  sku: string;
  defaultPrice: number;
  cost: number;
  stockQuantity: number;
  category: string;
  status: CatalogStatus;
  createdAt: string;
  updatedAt: string;
};

export type ServiceOrder = {
  id: string;
  number: string;
  customerId: string;
  vehicleId: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currentMileage: number;
  fuelLevel: number;
  entryState: string;
  priority: Priority;
  advisorId: string;
  mechanicId?: string;
  estimatedDeliveryAt?: string;
  startedAt?: string;
  finishedAt?: string;
  deliveredAt?: string;
  diagnosis?: string;
  mechanicRecommendations?: string;
  customerNotes?: string;
  internalNotes?: string;
  customerSignatureDataUrl?: string;
  mechanicSignatureDataUrl?: string;
  finalLaborAmount?: number;
  approvedQuoteRevisionId?: string;
  idempotencyKey?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type OrderItem = {
  id: string;
  orderId: string;
  type: "service" | "part" | "custom";
  catalogId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  laborPrice: number;
  discount: number;
  cost: number;
  notes?: string;
  doneAt?: string;
  doneBy?: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
};

export type InspectionItem = {
  id: string;
  orderId: string;
  label: string;
  category: string;
  status: InspectionStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type VehiclePhoto = {
  id: string;
  orderId: string;
  label: string;
  dataUrl: string;
  createdAt: string;
  createdBy: string;
};

export type QuoteRevision = {
  id: string;
  orderId: string;
  version: number;
  status: QuoteStatus;
  subtotalParts: number;
  subtotalLabor: number;
  discount: number;
  total: number;
  itemsSnapshot: OrderItem[];
  sentAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  createdAt: string;
  createdBy: string;
};

export type Payment = {
  id: string;
  orderId: string;
  method: PaymentMethod;
  amount: number;
  status: "pending" | "confirmed" | "cancelled";
  reference?: string;
  paidAt: string;
  createdAt: string;
  createdBy: string;
  idempotencyKey: string;
};

export type DocumentRecord = {
  id: string;
  orderId: string;
  type: DocumentType;
  status: DocumentStatus;
  version: number;
  publicToken: string;
  total: number;
  createdAt: string;
  createdBy: string;
  idempotencyKey: string;
};

export type Reminder = {
  id: string;
  customerId: string;
  vehicleId: string;
  orderId?: string;
  title: string;
  dueDate?: string;
  dueMileage?: number;
  status: "open" | "done" | "cancelled";
  notes?: string;
  createdAt: string;
};

export type AuditEvent = {
  id: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  userId: string;
  before?: unknown;
  after?: unknown;
  occurredAt: string;
  summary: string;
};

export type FiscalIntegrationConfig = {
  provider?: string;
  status: "not_configured" | "ready" | "unavailable";
  municipalityCode?: string;
  companyTaxId?: string;
  lastCheckedAt?: string;
};

export type WorkshopState = {
  company: {
    id: string;
    name: string;
    tradeName: string;
    phone: string;
    whatsapp: string;
    address: string;
    city: string;
    state: string;
    taxId?: string;
  };
  users: AppUser[];
  employees: Employee[];
  customers: Customer[];
  vehicles: Vehicle[];
  plateMemories: PlateMemory[];
  mileageRecords: MileageRecord[];
  services: CatalogService[];
  products: CatalogProduct[];
  orders: ServiceOrder[];
  orderItems: OrderItem[];
  inspectionItems: InspectionItem[];
  photos: VehiclePhoto[];
  quoteRevisions: QuoteRevision[];
  payments: Payment[];
  documents: DocumentRecord[];
  reminders: Reminder[];
  auditEvents: AuditEvent[];
  fiscalIntegration: FiscalIntegrationConfig;
  processedOperationKeys: string[];
  updatedAt: string;
};

export type OrderTotals = {
  subtotalParts: number;
  subtotalLabor: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
};

export type VehicleLookupResult =
  | {
      status: "found";
      brand: string;
      model: string;
      version?: string;
      year?: number;
      color?: string;
      category: Vehicle["category"];
      provider: string;
      imageUrl?: string;
    }
  | {
      status: "not_found" | "unavailable";
      provider?: string;
      message: string;
    };
