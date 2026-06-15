import { createRoot, type Root } from "react-dom/client";
import { PincodeAutoFill } from "@/components/integrations/PincodeAutoFill";
import { integrationFlags } from "@/integrations/config/integrationFlags";
import type { PincodeDetails } from "@/integrations/types/integrations.types";

type TextControl = HTMLInputElement | HTMLTextAreaElement;

const WIDGET_ATTR = "data-hrms-pincode-mounted";
const ROOTS = new WeakMap<Element, Root>();
let installed = false;
let observer: MutationObserver | null = null;
let scanTimer: number | null = null;

const setNativeValue = (element: TextControl, value: string) => {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (setter) setter.call(element, value);
  else element.value = value;

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

const getFieldLabel = (element: Element): string => {
  const parentLabel = element.closest("label")?.textContent || "";
  const wrapperLabel = element.parentElement?.querySelector("label")?.textContent || "";
  const fieldLabel = element.closest(".native-ats-fg, .space-y-1\.5, [data-field]")?.querySelector("label")?.textContent || "";
  return `${parentLabel} ${wrapperLabel} ${fieldLabel}`.toLowerCase();
};

const isAddressControl = (element: Element): element is TextControl => {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
  if (element.type && ["button", "submit", "checkbox", "radio", "file", "password", "hidden"].includes(element.type)) return false;

  const text = [
    element.id,
    element.name,
    element.placeholder,
    element.getAttribute("aria-label"),
    getFieldLabel(element),
  ].filter(Boolean).join(" ").toLowerCase();

  return text.includes("address") || element.id === "native_ats_field_address";
};

const findNearestAddressControl = (anchor: Element): TextControl | null => {
  const direct = anchor.querySelector("textarea, input") as TextControl | null;
  if (direct && isAddressControl(direct)) return direct;

  const previous = anchor.previousElementSibling?.querySelector("textarea, input") as TextControl | null;
  if (previous && isAddressControl(previous)) return previous;

  return null;
};

const findInputByLabel = (scope: Element, labels: string[]): HTMLInputElement | null => {
  const inputs = Array.from(scope.querySelectorAll("input")) as HTMLInputElement[];

  return inputs.find((input) => {
    const haystack = [
      input.id,
      input.name,
      input.placeholder,
      input.getAttribute("aria-label"),
      getFieldLabel(input),
    ].filter(Boolean).join(" ").toLowerCase();

    return labels.some((label) => haystack.includes(label));
  }) || null;
};

const buildLocationLine = (details: PincodeDetails, pincode: string) => {
  return [details.postOffice || details.city, details.district, details.state, details.country, pincode]
    .filter(Boolean)
    .join(", ");
};

const applyPincodeDetails = (anchor: Element, details: PincodeDetails, pincode: string) => {
  const addressControl = findNearestAddressControl(anchor);
  const locationLine = buildLocationLine(details, pincode);

  if (addressControl) {
    const currentValue = addressControl.value.trim();
    const nextValue = currentValue
      ? currentValue.includes(pincode) || currentValue.toLowerCase().includes(details.district.toLowerCase())
        ? currentValue
        : `${currentValue}\n${locationLine}`
      : locationLine;

    setNativeValue(addressControl, nextValue);
  }

  const scope = anchor.closest("form, .native-ats-form-card, .rounded-3xl, .space-y-6") || document.body;
  const cityInput = findInputByLabel(scope, ["city"]);
  const countryInput = findInputByLabel(scope, ["country"]);

  if (cityInput) setNativeValue(cityInput, details.district || details.city || "");
  if (countryInput) setNativeValue(countryInput, details.country || "India");
};

const getMountAnchor = (control: TextControl): Element => {
  return control.closest(".native-ats-fg, .space-y-1\.5") || control.parentElement || control;
};

const mountWidget = (control: TextControl) => {
  const anchor = getMountAnchor(control);
  if (anchor.getAttribute(WIDGET_ATTR) === "true") return;

  const host = document.createElement("div");
  host.className = "mt-2";
  anchor.insertAdjacentElement("afterend", host);
  anchor.setAttribute(WIDGET_ATTR, "true");

  const root = createRoot(host);
  ROOTS.set(anchor, root);
  root.render(
    <PincodeAutoFill
      onApply={(details, pincode) => applyPincodeDetails(anchor, details, pincode)}
    />,
  );
};

const scanAndMount = () => {
  if (!integrationFlags.pincodeAutoFill || typeof document === "undefined") return;

  const controls = Array.from(document.querySelectorAll("textarea, input")).filter(isAddressControl);
  controls.forEach(mountWidget);
};

const scheduleScan = () => {
  if (scanTimer) window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scanAndMount, 120);
};

export function installPincodeAutoFillRuntime() {
  if (installed || !integrationFlags.pincodeAutoFill || typeof window === "undefined") return;
  installed = true;

  scanAndMount();

  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

export function uninstallPincodeAutoFillRuntime() {
  observer?.disconnect();
  observer = null;
  installed = false;
}
