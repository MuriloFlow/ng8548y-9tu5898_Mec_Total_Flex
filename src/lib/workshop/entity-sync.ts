import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptCpf, hashCpf } from "@/lib/crypto/sensitive";
import type { WorkshopState } from "./types";

type SyncResult = { ok: true; tables: string[] } | { ok: false; error: string; tables: string[] };

function companyId(state: WorkshopState) {
  return state.company.id || "00000000-0000-4000-8000-000000000001";
}

async function upsertRows(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict = "id",
): Promise<void> {
  if (!rows.length) return;
  const chunkSize = table === "photos" ? 5 : 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function pruneOrphans(
  supabase: SupabaseClient,
  table: string,
  companyIdValue: string,
  keepIds: string[],
): Promise<void> {
  try {
    const { data, error } = await supabase.from(table).select("id").eq("company_id", companyIdValue);
    if (error || !data?.length) return;
    const remove = data.map((row) => row.id as string).filter((id) => !keepIds.includes(id));
    if (!remove.length) return;
    const { error: deleteError } = await supabase.from(table).delete().in("id", remove);
    if (deleteError) throw new Error(`${table}_prune: ${deleteError.message}`);
  } catch {
    return;
  }
}

/** Mirror every snapshot entity into normalized Supabase tables (including OS photos). */
export async function syncEntitiesToTables(supabase: SupabaseClient, state: WorkshopState): Promise<SyncResult> {
  const cid = companyId(state);
  const synced: string[] = [];

  try {
    const { error: companyError } = await supabase.from("company").upsert(
      {
        id: cid,
        name: state.company.name,
        trade_name: state.company.tradeName,
        phone: state.company.phone ?? "",
        whatsapp: state.company.whatsapp ?? "",
        address: state.company.address ?? "",
        city: state.company.city ?? "",
        state: state.company.state ?? "",
        tax_id: state.company.taxId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (companyError) throw new Error(`company: ${companyError.message}`);
    synced.push("company");

    if (state.employees.length) {
      await upsertRows(
        supabase,
        "employees",
        state.employees.map((employee) => ({
          id: employee.id,
          company_id: cid,
          name: employee.name,
          role: employee.role,
          phone: employee.phone ?? null,
          email: employee.email ?? null,
          active: employee.active,
          created_at: employee.createdAt,
          updated_at: new Date().toISOString(),
        })),
      );
      synced.push("employees");
    }

    await upsertRows(
      supabase,
      "customers",
      state.customers.map((customer) => ({
        id: customer.id,
        company_id: cid,
        cpf: encryptCpf(customer.cpf),
        cpf_hash: hashCpf(customer.cpf),
        name: customer.name,
        phone: customer.phone,
        email: customer.noEmail ? null : customer.email || null,
        no_email: customer.noEmail,
        address: customer.address ?? null,
        district: customer.district ?? null,
        notes: customer.notes ?? null,
        created_at: customer.createdAt,
        updated_at: customer.updatedAt,
        deleted_at: customer.deletedAt ?? null,
      })),
    );
    synced.push("customers");

    await upsertRows(
      supabase,
      "vehicles",
      state.vehicles.map((vehicle) => ({
          id: vehicle.id,
          company_id: cid,
          customer_id: vehicle.customerId,
          plate: vehicle.plate,
          brand: vehicle.brand,
          model: vehicle.model,
          version: vehicle.version ?? null,
          year: vehicle.year ?? null,
          color: vehicle.color ?? null,
          category: vehicle.category,
          lookup_status: vehicle.lookupStatus,
          lookup_provider: vehicle.lookupProvider ?? null,
          image_url: vehicle.imageUrl ?? null,
          created_at: vehicle.createdAt,
          updated_at: vehicle.updatedAt,
          deleted_at: vehicle.deletedAt ?? null,
        })),
    );
    synced.push("vehicles");

    await upsertRows(
      supabase,
      "mileage_records",
      state.mileageRecords.map((record) => ({
          id: record.id,
          company_id: cid,
          vehicle_id: record.vehicleId,
          order_id: record.orderId ?? null,
          mileage: record.mileage,
          recorded_at: record.recordedAt,
        })),
    );
    synced.push("mileage_records");

    if (state.services.length) {
      await upsertRows(
        supabase,
        "catalog_services",
        state.services.map((service) => ({
          id: service.id,
          company_id: cid,
          name: service.name,
          description: service.description ?? null,
          internal_code: service.internalCode ?? null,
          default_price: service.defaultPrice,
          default_labor: service.defaultLabor,
          cost: service.cost,
          estimated_minutes: service.estimatedMinutes,
          category: service.category ?? "",
          status: service.status,
          created_at: service.createdAt,
          updated_at: service.updatedAt,
        })),
      );
      synced.push("catalog_services");
    }

    if (state.products.length) {
      await upsertRows(
        supabase,
        "catalog_products",
        state.products.map((product) => ({
          id: product.id,
          company_id: cid,
          name: product.name,
          description: product.description ?? null,
          sku: product.sku,
          default_price: product.defaultPrice,
          cost: product.cost,
          stock_quantity: product.stockQuantity,
          category: product.category ?? "",
          status: product.status,
          created_at: product.createdAt,
          updated_at: product.updatedAt,
        })),
      );
      synced.push("catalog_products");
    }

    await upsertRows(
      supabase,
      "service_orders",
      state.orders.map((order) => ({
          id: order.id,
          company_id: cid,
          number: order.number,
          customer_id: order.customerId,
          vehicle_id: order.vehicleId,
          status: order.status,
          payment_status: order.paymentStatus,
          current_mileage: order.currentMileage ?? 0,
          fuel_level: order.fuelLevel ?? 0,
          entry_state: order.entryState ?? "",
          priority: order.priority,
          advisor_id: order.advisorId ?? null,
          mechanic_id: order.mechanicId ?? null,
          estimated_delivery_at: order.estimatedDeliveryAt ?? null,
          started_at: order.startedAt ?? null,
          finished_at: order.finishedAt ?? null,
          delivered_at: order.deliveredAt ?? null,
          diagnosis: order.diagnosis ?? null,
          mechanic_recommendations: order.mechanicRecommendations ?? null,
          customer_notes: order.customerNotes ?? null,
          internal_notes: order.internalNotes ?? null,
          customer_signature_data_url: order.customerSignatureDataUrl ?? null,
          mechanic_signature_data_url: order.mechanicSignatureDataUrl ?? null,
          final_labor_amount: order.finalLaborAmount ?? 0,
          approved_quote_revision_id: order.approvedQuoteRevisionId ?? null,
          idempotency_key: order.idempotencyKey ?? null,
          version: order.version,
          created_at: order.createdAt,
          updated_at: order.updatedAt,
          deleted_at: order.deletedAt ?? null,
        })),
    );
    synced.push("service_orders");

    await upsertRows(
      supabase,
      "order_items",
      state.orderItems.map((item, index) => ({
          id: item.id,
          company_id: cid,
          order_id: item.orderId,
          type: item.type,
          catalog_id: item.catalogId ?? null,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          labor_price: item.laborPrice,
          discount: item.discount,
          cost: item.cost,
          notes: item.notes ?? null,
          done_at: item.doneAt ?? null,
          done_by: item.doneBy ?? null,
          sort_order: index,
          created_at: item.createdAt,
          updated_at: item.updatedAt,
        })),
    );
    synced.push("order_items");

    if (state.inspectionItems.length) {
      await upsertRows(
        supabase,
        "inspection_items",
        state.inspectionItems.map((item) => ({
          id: item.id,
          company_id: cid,
          order_id: item.orderId,
          label: item.label,
          category: item.category,
          status: item.status,
          notes: item.notes ?? null,
          created_at: item.createdAt,
          updated_at: item.updatedAt,
        })),
      );
      synced.push("inspection_items");
    }

    if (state.photos.length) {
      await upsertRows(
        supabase,
        "photos",
        state.photos.map((photo) => ({
          id: photo.id,
          company_id: cid,
          order_id: photo.orderId,
          label: photo.label,
          data_url: photo.dataUrl,
          created_at: photo.createdAt,
          created_by: photo.createdBy,
        })),
      );
      synced.push("photos");
    }
    await pruneOrphans(
      supabase,
      "photos",
      cid,
      state.photos.map((photo) => photo.id),
    );

    if (state.quoteRevisions.length) {
      await upsertRows(
        supabase,
        "quote_revisions",
        state.quoteRevisions.map((revision) => ({
          id: revision.id,
          company_id: cid,
          order_id: revision.orderId,
          version: revision.version,
          status: revision.status,
          subtotal_parts: revision.subtotalParts,
          subtotal_labor: revision.subtotalLabor,
          discount: revision.discount,
          total: revision.total,
          items_snapshot: revision.itemsSnapshot,
          sent_at: revision.sentAt ?? null,
          approved_at: revision.approvedAt ?? null,
          approved_by: revision.approvedBy ?? null,
          created_at: revision.createdAt,
          created_by: revision.createdBy,
        })),
        "id",
      );
      synced.push("quote_revisions");
    }

    if (state.payments.length) {
      await upsertRows(
        supabase,
        "payments",
        state.payments.map((payment) => ({
          id: payment.id,
          company_id: cid,
          order_id: payment.orderId,
          method: payment.method,
          amount: payment.amount,
          status: payment.status,
          reference: payment.reference ?? null,
          paid_at: payment.paidAt,
          created_at: payment.createdAt,
          created_by: payment.createdBy,
          idempotency_key: payment.idempotencyKey,
        })),
      );
      synced.push("payments");
    }

    if (state.documents.length) {
      await upsertRows(
        supabase,
        "documents",
        state.documents.map((document) => ({
          id: document.id,
          company_id: cid,
          order_id: document.orderId,
          type: document.type,
          status: document.status,
          version: document.version,
          public_token: document.publicToken,
          total: document.total,
          created_at: document.createdAt,
          created_by: document.createdBy,
          idempotency_key: document.idempotencyKey,
        })),
      );
      synced.push("documents");
    }

    if (state.reminders.length) {
      await upsertRows(
        supabase,
        "reminders",
        state.reminders.map((reminder) => ({
          id: reminder.id,
          company_id: cid,
          customer_id: reminder.customerId,
          vehicle_id: reminder.vehicleId,
          order_id: reminder.orderId ?? null,
          title: reminder.title,
          due_date: reminder.dueDate ?? null,
          due_mileage: reminder.dueMileage ?? null,
          status: reminder.status,
          notes: reminder.notes ?? null,
          created_at: reminder.createdAt,
        })),
      );
      synced.push("reminders");
    }

    if (state.auditEvents.length) {
      await upsertRows(
        supabase,
        "audit_events",
        state.auditEvents.map((event) => ({
          id: event.id,
          company_id: cid,
          entity_type: event.entityType,
          entity_id: event.entityId,
          action: event.action,
          user_id: event.userId,
          before_data: event.before ?? null,
          after_data: event.after ?? null,
          occurred_at: event.occurredAt,
          summary: event.summary,
        })),
      );
      synced.push("audit_events");
    }

    if (state.processedOperationKeys.length) {
      await upsertRows(
        supabase,
        "processed_operation_keys",
        state.processedOperationKeys.map((key) => ({
          key,
          company_id: cid,
          created_at: new Date().toISOString(),
        })),
        "key",
      );
      synced.push("processed_operation_keys");
    }

    return { ok: true, tables: synced };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      tables: synced,
    };
  }
}
