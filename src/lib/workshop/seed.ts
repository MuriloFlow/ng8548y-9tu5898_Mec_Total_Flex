import type { WorkshopState } from "./types";

const companyId = "00000000-0000-4000-8000-000000000001";
const adminId = "00000000-0000-4000-8000-000000000021";
const adminEmployeeId = "00000000-0000-4000-8000-000000000011";

export function createSeedState(): WorkshopState {
  const now = new Date().toISOString();

  return {
    company: {
      id: companyId,
      name: "Auto Mecânica Total Flex",
      tradeName: "Total Flex",
      phone: "11948499650",
      whatsapp: "11948499650",
      address: "Estrada Cata Preta, 898 - Vila João Ramalho",
      city: "Santo André",
      state: "SP",
    },
    users: [
      {
        id: adminId,
        username: "totalflex",
        displayName: "Total Flex",
        role: "admin",
        active: true,
        employeeId: adminEmployeeId,
        createdAt: now,
      },
    ],
    employees: [
      {
        id: adminEmployeeId,
        name: "Total Flex",
        role: "admin",
        phone: "11948499650",
        active: true,
        createdAt: now,
      },
    ],
    customers: [],
    vehicles: [],
    plateMemories: [],
    mileageRecords: [],
    services: [],
    products: [],
    orders: [],
    orderItems: [],
    inspectionItems: [],
    photos: [],
    quoteRevisions: [],
    payments: [],
    documents: [],
    reminders: [],
    auditEvents: [],
    fiscalIntegration: {
      status: "not_configured",
    },
    processedOperationKeys: [],
    updatedAt: now,
  };
}
