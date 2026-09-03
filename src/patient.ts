// Wiring for the page under test.
//
// The defects here are INTENTIONAL fixtures so every audit rule has something
// real to detect. The pay handler throws on purpose (reliability rule), but it
// now reports a visible failure state instead of leaving "Processing…" forever,
// which is what a real broken checkout looks like to a user.

interface PendingOrder { total: number }

export function wireSubject(): void {
  const pay = document.getElementById("pay") as HTMLButtonElement | null;
  const status = document.getElementById("pay-status");

  pay?.addEventListener("click", () => {
    if (status) status.textContent = "Processing…";
    try {
      // DEFECT: this object is never initialised, so the property read throws.
      const order = (window as unknown as { __order?: PendingOrder }).__order;
      const total = (order as PendingOrder).total;
      if (status) status.textContent = `Charged $${total.toFixed(2)}`;
    } catch (err) {
      // Report to the user AND to the console recorder, as a real app should.
      if (status) status.textContent = "Payment failed. Please try again.";
      console.error(
        `Checkout submit failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  document.querySelectorAll<HTMLButtonElement>(".icon").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest("li")?.remove());
  });
}
