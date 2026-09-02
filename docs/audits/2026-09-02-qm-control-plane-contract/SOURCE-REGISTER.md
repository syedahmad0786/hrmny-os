# Source register

## Reviewed authority

The complete 18-source verification record is stored in the system-harness run at:

`C:\Users\ahmad\Work\Clients\Harmony\hrmny-build\hrmny-os-phase0-20260829\.system-harness\runs\20260902T020544Z\OFFICIAL_SOURCE_VERIFICATION_20260902.md`

SHA-256: `8A8F4E8774818AEFE6A538913CE59CA3A70236D2F5A6D8CC9BBDCC20A0D77534`

## Sources controlling this slice

| Source                                                                                 | Reviewed finding                                                                                             | Design consequence                                                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [QM v0.1.5 release](https://github.com/yc-software/qm/releases/tag/v0.1.5)             | Stable reviewed version pinned to commit `d931fe963de3ac20b9a7526ea9a4873c0d8ed18e`                          | The session contract rejects a different upstream version or commit                    |
| [QM security model](https://github.com/yc-software/qm/blob/v0.1.5/SECURITY.md)         | Early/experimental, for authenticated internal users; QM agent and sandbox are not authorization authorities | HRMNY retains identity, scope, approval, and effect authority; no public/client access |
| [Fly private networking](https://fly.io/docs/networking/private-networking/)           | Private addresses are not a stable service-discovery contract                                                | Any future provider adapter must use provider readback and a stable internal hostname  |
| [Fly custom private networks](https://fly.io/docs/networking/custom-private-networks/) | Custom networks can separate tenant or user workloads                                                        | Personal QM isolation remains a provider-phase requirement, not a local-code claim     |
| [Fly shared responsibility](https://fly.io/docs/security/shared-responsibility/)       | Application configuration, credentials, and access controls remain operator responsibilities                 | Provider setup cannot substitute for HRMNY authorization or credential controls        |

## Project pins versus current upstream

The contract intentionally pins the reviewed stable QM release rather than a moving default branch. Source verification is not provider verification: no Fly account, app, machine, private network, secret, billing state, or DNS route was read or changed in this phase.
