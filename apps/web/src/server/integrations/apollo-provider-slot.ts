export const APOLLO_PROVIDER_CONCURRENCY_KEY = "provider:apollo";

export class ProviderCredentialMutationBusyError extends Error {
  constructor(
    readonly toolkit: string,
    code = "PROVIDER_CREDENTIAL_MUTATION_BUSY",
  ) {
    super(code);
    this.name = "ProviderCredentialMutationBusyError";
  }
}

export class ApolloProviderMutationBusyError extends ProviderCredentialMutationBusyError {
  constructor() {
    super("apollo", "APOLLO_PROVIDER_MUTATION_BUSY");
    this.name = "ApolloProviderMutationBusyError";
  }
}
