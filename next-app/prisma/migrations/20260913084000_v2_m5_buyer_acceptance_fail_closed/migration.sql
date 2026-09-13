-- M5-02 fail-closed hardening.
-- AUTO_ACCEPT requires its own deterministic timeout policy and authenticated system evidence.
-- Until that boundary is implemented, only Buyer-signed decisions are valid protocol writes.

ALTER TABLE "delivery_acceptance_decisions"
  ADD CONSTRAINT "delivery_acceptance_decisions_m5_02_source_gate"
  CHECK ("source" = 'buyer_signed');
