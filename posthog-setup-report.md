# PostHog post-wizard report

The wizard has completed a full PostHog integration across two TanStack Start workers — `store` (e-commerce) and `identity` (auth/account). Both workers now have `PostHogProvider` in their root routes for client-side autocapture, session replay, and error tracking. A server-side `posthog-node` singleton (`src/lib/posthog-server.ts`) captures the critical `order_placed` event directly from the `placeOrder` server function. Users are identified on page load (via `PostHogIdentifier` in identity's `__root.tsx`) and on sign-in/sign-up events; `posthog.reset()` is called on sign-out and account deletion.

| Event                    | Description                                                            | File                                                                 |
| ------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `product_viewed`         | User viewed a product detail page — top of the purchase funnel.        | `workers/store/src/routes/_public/products.$slug.tsx`                |
| `add_to_cart`            | User added a product variant to the cart.                              | `workers/store/src/routes/_public/products.$slug.tsx`                |
| `remove_from_cart`       | User removed a product line from the cart.                             | `workers/store/src/routes/_public/cart.tsx`                          |
| `cart_quantity_changed`  | User changed the quantity of a cart line item.                         | `workers/store/src/routes/_public/cart.tsx`                          |
| `checkout_started`       | User landed on the checkout page with items in their cart.             | `workers/store/src/routes/_app/checkout.tsx`                         |
| `order_placed`           | Order was successfully created server-side — the key conversion event. | `workers/store/src/lib/orders.functions.ts`                          |
| `checkout_failed`        | Order placement returned an error or threw during checkout.            | `workers/store/src/routes/_app/checkout.tsx`                         |
| `signed_up`              | User successfully created a new account.                               | `workers/identity/src/components/auth/sign-up-form.tsx`              |
| `signed_in`              | User successfully signed in with email/password.                       | `workers/identity/src/components/auth/sign-in-form.tsx`              |
| `signed_in_with_passkey` | User successfully signed in using a passkey.                           | `workers/identity/src/components/auth/sign-in-form.tsx`              |
| `magic_link_requested`   | User requested a magic sign-in link via email.                         | `workers/identity/src/components/auth/sign-in-form.tsx`              |
| `signed_out`             | User explicitly signed out from the dashboard.                         | `workers/identity/src/components/dashboard/sidebar-user-menu.tsx`    |
| `account_deleted`        | User permanently deleted their account.                                | `workers/identity/src/components/account/delete-account-dialog.tsx`  |
| `password_changed`       | User successfully changed their account password.                      | `workers/identity/src/components/account/change-password-dialog.tsx` |

## Next steps

We've built a dashboard and five insights to monitor user behavior from day one:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/501959/dashboard/1811634)
- [Purchase Funnel (wizard)](https://us.posthog.com/project/501959/insights/jBFBvgzW) — product_viewed → add_to_cart → checkout_started → order_placed
- [Sign-ups & Sign-ins Over Time (wizard)](https://us.posthog.com/project/501959/insights/xzg5Yfyg) — daily trend of registrations and logins by method
- [Orders Placed Over Time (wizard)](https://us.posthog.com/project/501959/insights/4Dpkk1Bi) — daily order volume vs checkouts started
- [Checkout Failures (wizard)](https://us.posthog.com/project/501959/insights/Z77dSiZE) — failed checkout attempts over time
- [Account Deletions (wizard)](https://us.posthog.com/project/501959/insights/yv1QBu1q) — churn signal: permanent account removals

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN` and `VITE_PUBLIC_POSTHOG_HOST` to `.env.example` and any monorepo bootstrap scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify in PostHog error tracking.
- [ ] Confirm the returning-visitor path also calls `identify` — the `PostHogIdentifier` component in identity's `__root.tsx` handles this for that worker, but the store worker does not have a session-based identifier; add one if you want returning store sessions linked to known users.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
