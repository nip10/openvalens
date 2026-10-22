declare module "@/utils/orpc" {
  export const client: import("@openvalens/api/routers/index").AppRouterClient;
  export const orpc: ReturnType<
    typeof import("@orpc/tanstack-query").createTanstackQueryUtils<
      import("@openvalens/api/routers/index").AppRouterClient
    >
  >;
  export const queryClient: import("@tanstack/react-query").QueryClient;
}
