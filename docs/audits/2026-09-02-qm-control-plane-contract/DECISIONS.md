# Decisions

1. **HRMNY is the authorization authority.** Organization and employee identity are accepted only through a separately parsed trusted principal. The command envelope cannot carry identity.
2. **QM remains an execution workspace.** It is not the source of record for identity, approval, operational state, or effect receipts.
3. **Reads stop at a precheck.** `workspace.read_precheck_request` records a typed resource ID and purpose digest. A later repository adapter must still resolve current ownership and scope before returning data.
4. **External work stops at a proposal.** The contract records a digest-only proposal. There is no direct-effect command and no payload or credential field.
5. **Authorization precedes replay.** Every request rechecks the current session lifecycle, owner, organization, personal scope, and capability before consulting an earlier decision.
6. **Replay binds policy state.** A valid replay requires the same request digest, session state version, session-policy digest, upstream commit, runtime kind, and provider readback metadata.
7. **Denials are non-enumerating.** Public denials use one reason code and return no stored personal scope, runtime, upstream, or session-policy metadata.
8. **Durability is an interface obligation.** The repository contract requires an atomic durable uniqueness boundary, while the current in-memory test implementation proves only interface behavior.
