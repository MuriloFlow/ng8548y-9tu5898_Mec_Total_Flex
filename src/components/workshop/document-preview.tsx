"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Download, FileText, Printer, QrCode, Share2 } from "lucide-react";
import { jsPDF } from "jspdf";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DOCUMENT_TYPE_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/workshop/constants";
import {
  formatCpf,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhone,
  formatPlate,
  newId,
} from "@/lib/workshop/format";
import { getCustomer, getEmployeeName, getOrderItems, getOrderPayments, getOrderTotals, getVehicle } from "@/lib/workshop/selectors";
import { useWorkshop } from "@/lib/workshop/store";
import type { DocumentType, OrderItem, ServiceOrder, WorkshopState } from "@/lib/workshop/types";

type DocumentPreviewProps = {
  orderId: string;
};

function itemTotal(item: OrderItem) {
  return item.quantity * (item.unitPrice + item.laborPrice) - item.discount;
}

export function buildDocumentPdf(state: WorkshopState, order: ServiceOrder, type: DocumentType, logoDataUrl?: string) {
  const customer = getCustomer(state, order.customerId);
  const vehicle = getVehicle(state, order.vehicleId);
  const items = getOrderItems(state, order.id);
  const payments = getOrderPayments(state, order.id);
  const totals = getOrderTotals(state, order.id);
  const pdf = new jsPDF({ unit: "mm", format: "a4" });

  pdf.setProperties({
    title: `${DOCUMENT_TYPE_LABEL[type]} ${order.number}`,
    subject: state.company.tradeName,
    creator: "Total Flex OS",
  });

  // ─── Header box ───────────────────────────────────────────────────────────
  pdf.setLineWidth(0.35);
  pdf.roundedRect(10, 8, 190, 42, 2, 2);
  pdf.setFont("helvetica", "bold");
  if (logoDataUrl) {
    pdf.addImage(logoDataUrl, "PNG", 16, 12, 46, 26);
    pdf.setFontSize(11);
    pdf.text(state.company.tradeName.toUpperCase(), 18, 45);
  } else {
    pdf.setFontSize(18);
    pdf.text("AUTO MECANICA", 18, 18);
    pdf.setFontSize(24);
    pdf.text("TOTAL FLEX", 18, 35);
  }
  pdf.setFontSize(12);
  pdf.text("MECÂNICA EM GERAL", 125, 18);
  pdf.text("INJEÇÃO ELETRÔNICA", 125, 25);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(`Tel.: ${formatPhone(state.company.phone)}`, 125, 35);
  pdf.text(state.company.address, 125, 42, { maxWidth: 68 });

  // ─── Document title ────────────────────────────────────────────────────────
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(`${DOCUMENT_TYPE_LABEL[type]} · ${order.number}`, 10, 60);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);

  // ─── Customer info — 3 rows as requested ──────────────────────────────────
  // Row 1: Cliente | CPF | Tel | Data de emissão
  pdf.text(`Cliente: ${customer?.name ?? ""}`, 10, 68);
  pdf.text(`CPF: ${formatCpf(customer?.cpf ?? "")}`, 80, 68);
  pdf.text(`Tel.: ${formatPhone(customer?.phone ?? "")}`, 130, 68);
  pdf.text(`Emissão: ${formatDate(order.createdAt)}`, 10, 75);

  // Row 2: Endereço | Bairro | Placa
  pdf.text(`Endereço: ${customer?.address ?? ""}`, 10, 83);
  pdf.text(`Bairro: ${customer?.district ?? ""}`, 110, 83);
  pdf.text(`Placa: ${formatPlate(vehicle?.plate ?? "")}`, 165, 83);

  // Row 3: Veículo | Ano | Cor
  pdf.text(`Veículo: ${vehicle?.model ?? ""}`, 10, 91);
  pdf.text(`Ano: ${vehicle?.year ?? ""}`, 80, 91);
  pdf.text(`Cor: ${vehicle?.color ?? ""}`, 120, 91);

  // ─── Items table ───────────────────────────────────────────────────────────
  const tableTop = 96;
  pdf.setFillColor(24, 24, 27);
  pdf.rect(10, tableTop, 190, 9, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.text("Quant.", 13, tableTop + 6);
  pdf.text("Descrição", 42, tableTop + 6);
  pdf.text("TOTAL R$", 168, tableTop + 6);
  pdf.setTextColor(0, 0, 0);
  pdf.setFont("helvetica", "normal");

  let y = tableTop + 9;
  const rowHeight = 10;
  const rows = Math.max(10, items.length);
  for (let index = 0; index < rows; index += 1) {
    pdf.rect(10, y, 190, rowHeight);
    pdf.line(32, y, 32, y + rowHeight);
    pdf.line(160, y, 160, y + rowHeight);
    const item = items[index];
    if (item) {
      pdf.text(String(item.quantity), 14, y + 7);
      pdf.text(item.description, 36, y + 7, { maxWidth: 118 });
      // itemTotal = quantity * (unitPrice + laborPrice) - discount
      const lineTotal = item.quantity * (item.unitPrice + item.laborPrice) - item.discount;
      pdf.text(formatCurrency(lineTotal).replace("R$", "").trim(), 164, y + 7);
    }
    y += rowHeight;
  }

  // ─── Observation + totals box ──────────────────────────────────────────────
  const obsTop = y;
  pdf.setFont("helvetica", "bold");
  pdf.text("Observação", 10, obsTop + 8);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(order.customerNotes || order.diagnosis || "", 10, obsTop + 15, { maxWidth: 120 });
  pdf.setFontSize(10);

  const totalsX = 132;
  const totalsH = 30;
  pdf.rect(totalsX, obsTop, 68, totalsH);
  pdf.line(totalsX, obsTop + 10, 200, obsTop + 10);
  pdf.line(totalsX, obsTop + 20, 200, obsTop + 20);
  pdf.line(166, obsTop, 166, obsTop + totalsH);
  pdf.setFont("helvetica", "bold");
  pdf.text("Total Peças", totalsX + 3, obsTop + 7);
  pdf.text("Total M.O.", totalsX + 3, obsTop + 17);
  pdf.text("Total Geral", totalsX + 3, obsTop + 27);
  pdf.setFont("helvetica", "normal");
  pdf.text(formatCurrency(totals.subtotalParts).replace("R$", "").trim(), 170, obsTop + 7);
  pdf.text(formatCurrency(totals.subtotalLabor).replace("R$", "").trim(), 170, obsTop + 17);
  pdf.text(formatCurrency(totals.total).replace("R$", "").trim(), 170, obsTop + 27);

  // ─── Payment info line ─────────────────────────────────────────────────────
  const payInfoY = obsTop + totalsH + 6;
  pdf.setFontSize(8);
  pdf.text(
    `Pagamento: ${PAYMENT_STATUS_LABEL[order.paymentStatus]} · Pago ${formatCurrency(totals.paid)} · Saldo ${formatCurrency(totals.balance)}`,
    10,
    payInfoY,
  );
  if (payments[0]) {
    pdf.text(
      `Último pgto: ${PAYMENT_METHOD_LABEL[payments[0].method]} em ${formatDateTime(payments[0].paidAt)}`,
      10,
      payInfoY + 5,
    );
  }

  // ─── Signatures — always at the very bottom, no overlap ───────────────────
  // Signatures are placed at fixed positions near bottom of page (A4 = 297mm)
  // Ensure there's always enough room: place at y=265 or below obsTop+totalsH+20, whichever is lower
  const sigY = Math.max(265, payInfoY + (payments[0] ? 14 : 9));

  // Draw signature lines at the bottom
  pdf.setFontSize(9);
  pdf.text("Assinatura do cliente:", 10, sigY);
  pdf.line(10, sigY + 14, 90, sigY + 14);

  pdf.text("Assinatura do mecânico:", 110, sigY);
  pdf.line(110, sigY + 14, 200, sigY + 14);

  // Draw signature images above the lines
  if (order.customerSignatureDataUrl) {
    pdf.addImage(order.customerSignatureDataUrl, "PNG", 10, sigY + 1, 80, 12);
  }
  if (order.mechanicSignatureDataUrl) {
    pdf.addImage(order.mechanicSignatureDataUrl, "PNG", 110, sigY + 1, 80, 12);
  }

  if (type === "fiscal_receipt") {
    pdf.setTextColor(180, 83, 9);
    pdf.setFontSize(7);
    pdf.text("Comprovante interno. NF-e/NFS-e válida exige provedor fiscal autorizado.", 10, sigY + 18);
    pdf.setTextColor(0, 0, 0);
  }

  return pdf;
}

export function DocumentPreview({ orderId }: DocumentPreviewProps) {
  const { state, generateDocument } = useWorkshop();
  const [type, setType] = useState<DocumentType>("service_order");
  const [logoDataUrl, setLogoDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/assets/logo.png")
      .then((response) => response.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }),
      )
      .then((dataUrl) => {
        if (!cancelled) setLogoDataUrl(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const order = state?.orders.find((item) => item.id === orderId);
  const payload = useMemo(() => {
    if (!state || !order) return null;
    const customer = getCustomer(state, order.customerId);
    const vehicle = getVehicle(state, order.vehicleId);
    const items = getOrderItems(state, order.id);
    const totals = getOrderTotals(state, order.id);
    const documents = state.documents.filter((document) => document.orderId === order.id && document.status === "generated");
    return { customer, vehicle, items, totals, documents };
  }, [order, state]);

  if (!state || !order || !payload) return null;

  const currentState = state;
  const currentOrder = order;
  const latestDocument = payload.documents[0];
  const token = latestDocument?.publicToken ?? `${currentOrder.number.toLowerCase()}-preview`;
  const publicUrl = `https://totalflex.local/docs/${token}`;

  function createRecord() {
    try {
      generateDocument(currentOrder.id, type, newId("document_op"));
      toast.success("Documento registrado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o documento.");
    }
  }

  function downloadPdf(mode: "download" | "print" | "share") {
    const pdf = buildDocumentPdf(currentState, currentOrder, type, logoDataUrl);
    const fileName = `${currentOrder.number}-${type}.pdf`;

    if (mode === "download") {
      pdf.save(fileName);
      return;
    }

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);

    if (mode === "print") {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    const file = new File([blob], fileName, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      void navigator.share({ title: fileName, files: [file] });
    } else {
      pdf.save(fileName);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["service_order", "quote", "receipt", "fiscal_receipt"] as DocumentType[]).map((option) => (
          <Button key={option} type="button" size="sm" variant={type === option ? "default" : "outline"} onClick={() => setType(option)}>
            {DOCUMENT_TYPE_LABEL[option]}
          </Button>
        ))}
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="rounded-lg border-2 border-zinc-950 bg-white p-3 text-zinc-950">
          <div className="grid grid-cols-[1fr_auto] gap-3 border-b-2 border-zinc-950 pb-3">
            <div>
              <Image
                src="/assets/logo.png"
                alt="Auto Mecânica Total Flex"
                width={180}
                height={90}
                className="h-16 w-36 object-contain"
              />
            </div>
            <div className="text-right text-xs font-semibold leading-5">
              <p>MECÂNICA EM GERAL</p>
              <p>INJEÇÃO ELETRÔNICA</p>
              <p className="mt-2 font-normal">{formatPhone(state.company.phone)}</p>
              <p className="max-w-36 font-normal">{state.company.address}</p>
            </div>
          </div>

          <div className="space-y-1 border-b-2 border-zinc-950 py-3 text-sm">
            <div className="flex justify-between gap-2">
              <span>Data de Emissão: {formatDate(order.createdAt)}</span>
              <strong>{order.number}</strong>
            </div>
            <p>Cliente: {payload.customer?.name}</p>
            <p>Endereço: {payload.customer?.address || "Não informado"}</p>
            <div className="grid grid-cols-2 gap-2">
              <span>Bairro: {payload.customer?.district || "-"}</span>
              <span>Tel.: {formatPhone(payload.customer?.phone ?? "")}</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <span className="col-span-1">Veículo: {payload.vehicle?.model}</span>
              <span>Ano: {payload.vehicle?.year}</span>
              <span>Cor: {payload.vehicle?.color}</span>
              <span>Placa: {formatPlate(payload.vehicle?.plate ?? "")}</span>
            </div>
          </div>

          <div className="overflow-hidden border-x-2 border-b-2 border-zinc-950 text-xs">
            <div className="grid grid-cols-[56px_1fr_88px] bg-zinc-950 py-2 font-bold text-white">
              <span className="px-2">Quant.</span>
              <span className="border-l border-white/40 px-2">Descrição</span>
              <span className="border-l border-white/40 px-2 text-right">TOTAL R$</span>
            </div>
            {Array.from({ length: Math.max(9, payload.items.length) }).map((_, index) => {
              const item = payload.items[index];
              return (
                <div key={item?.id ?? index} className="grid min-h-9 grid-cols-[56px_1fr_88px] border-t border-zinc-300">
                  <span className="px-2 py-2">{item?.quantity ?? ""}</span>
                  <span className="border-l border-zinc-300 px-2 py-2">{item?.description ?? ""}</span>
                  <span className="border-l border-zinc-300 px-2 py-2 text-right">{item ? formatCurrency(itemTotal(item)) : ""}</span>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-[1fr_136px] gap-3 pt-3">
            <div>
              <p className="text-sm font-bold">Observação</p>
              <p className="mt-2 min-h-16 text-xs leading-5">{order.customerNotes || order.diagnosis || "Sem observações públicas."}</p>
            </div>
            <div className="overflow-hidden rounded border border-zinc-950 text-xs">
              <div className="grid grid-cols-2 border-b border-zinc-950">
                <strong className="px-2 py-2">Total Peças</strong>
                <span className="border-l border-zinc-950 px-2 py-2 text-right">{formatCurrency(payload.totals.subtotalParts)}</span>
              </div>
              <div className="grid grid-cols-2 border-b border-zinc-950">
                <strong className="px-2 py-2">Total M.O.</strong>
                <span className="border-l border-zinc-950 px-2 py-2 text-right">{formatCurrency(payload.totals.subtotalLabor)}</span>
              </div>
              <div className="grid grid-cols-2">
                <strong className="px-2 py-2">Total Geral</strong>
                <span className="border-l border-zinc-950 px-2 py-2 text-right font-bold">{formatCurrency(payload.totals.total)}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-end justify-between gap-3 border-t border-zinc-200 pt-3">
            <div className="space-y-1 text-xs text-zinc-600">
              <p>Responsável: {getEmployeeName(state, order.mechanicId)}</p>
              <p>
                Pago {formatCurrency(payload.totals.paid)} · Saldo {formatCurrency(payload.totals.balance)}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {order.customerSignatureDataUrl ? (
                  <Image
                    src={order.customerSignatureDataUrl}
                    alt="Assinatura do cliente"
                    width={240}
                    height={80}
                    unoptimized
                    className="h-12 w-36 rounded border border-zinc-200 bg-white object-contain"
                  />
                ) : null}
                {order.mechanicSignatureDataUrl ? (
                  <Image
                    src={order.mechanicSignatureDataUrl}
                    alt="Assinatura do mecânico"
                    width={240}
                    height={80}
                    unoptimized
                    className="h-12 w-36 rounded border border-zinc-200 bg-white object-contain"
                  />
                ) : null}
              </div>
              {type === "fiscal_receipt" ? (
                <p className="font-semibold text-amber-700">NF-e/NFS-e válida depende de provedor fiscal autorizado.</p>
              ) : null}
            </div>
            <div className="grid place-items-center gap-1">
              <QRCodeCanvas value={publicUrl} size={62} />
              <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                <QrCode className="size-3" /> consulta
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button type="button" variant="secondary" onClick={createRecord}>
          <FileText /> Registrar
        </Button>
        <Button type="button" variant="outline" onClick={() => downloadPdf("download")}>
          <Download /> Baixar
        </Button>
        <Button type="button" variant="outline" onClick={() => downloadPdf("print")}>
          <Printer /> Imprimir
        </Button>
        <Button type="button" variant="outline" onClick={() => downloadPdf("share")}>
          <Share2 /> Compartilhar
        </Button>
      </div>
    </div>
  );
}
