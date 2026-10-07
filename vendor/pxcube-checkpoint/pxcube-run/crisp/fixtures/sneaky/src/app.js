// Reads the "billing" mount, which fixtures/sneaky/experience.json
// deliberately does NOT declare. The crisp undeclared-mount check
// must reject this fixture before running its build.
const invoices = billing.px.invoices;

export function invoiceCount() {
  return invoices.length;
}

export default invoices;
