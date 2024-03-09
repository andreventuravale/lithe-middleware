import { produce } from 'immer'

export type MiddlewareHandler<Input = unknown> = <Output = unknown>(
  input: Input
) => Promise<Output>

export type Next = (input: unknown) => Promise<unknown>

export type AnonymousMiddleware<Input = unknown> = (
  next: Next
) => MiddlewareHandler<Input>

export type NamedMiddleware<Input = unknown> = [
  string,
  AnonymousMiddleware<Input>
]

export type Middleware<Input = unknown> =
  | AnonymousMiddleware<Input>
  | NamedMiddleware<Input>

export type PipelineModification<Input = unknown> =
  | [Middleware<Input>, 'before' | 'after' | 'replace', ref: string]
  | ['skip', name: string]
  | Middleware<Input>

export interface Pipeline<Input = unknown> {
  (modifications?: PipelineModification[]): MiddlewareHandler<Input>
  connect: (next: Next) => Pipeline<Input>
}

export type PipelineEventType =
  | 'request-begin'
  | 'request-end'
  | 'invocation-begin'
  | 'invocation-end'

export type PipelineBaseEvent<Type extends PipelineEventType> = {
  type: Type
  input: unknown
  /**
   * Pipeline id
   */
  pid: string
  /**
   * Parent Pipeline id
   */
  ppid?: string
  pipelineName: string
}

export type PipelineBaseRequestEvent<Type extends PipelineEventType> =
  PipelineBaseEvent<Type> & {
    /**
     * Request id
     */
    rid: string
  }

export type PipelineRequestBeginEvent =
  PipelineBaseRequestEvent<'request-begin'>

export type PipelineRequestSuccessEvent =
  PipelineBaseRequestEvent<'request-end'> & {
    status: 'success'
    output: unknown
  }

export type PipelineRequestFailureEvent =
  PipelineBaseRequestEvent<'request-end'> & {
    status: 'failure'
    error: Error
  }

export type PipelineRequestEndEvent =
  | PipelineRequestSuccessEvent
  | PipelineRequestFailureEvent

export type PipelineRequestEvent =
  | PipelineRequestBeginEvent
  | PipelineRequestEndEvent

export type PipelineBaseInvocationEvent<Type extends PipelineEventType> =
  PipelineBaseRequestEvent<Type> & {
    name: string | undefined
    /**
     * Invocation id ( aka middleware invocation id )
     */
    iid: string
  }

export type PipelineInvocationBeginEvent =
  PipelineBaseInvocationEvent<'invocation-begin'>

export type PipelineInvocationSuccessEvent =
  PipelineBaseInvocationEvent<'invocation-end'> & {
    status: 'success'
    output: unknown
  }

export type PipelineInvocationFailureEvent =
  PipelineBaseInvocationEvent<'invocation-end'> & {
    status: 'failure'
    error: Error
  }

export type PipelineInvocationEndEvent =
  | PipelineInvocationSuccessEvent
  | PipelineInvocationFailureEvent

export type PipelineInvocationEvent =
  | PipelineInvocationBeginEvent
  | PipelineInvocationEndEvent

export type PipelineEventsWithOutput =
  | PipelineRequestSuccessEvent
  | PipelineInvocationSuccessEvent

export type PipelineEventsWithoutOutput =
  | PipelineRequestBeginEvent
  | PipelineInvocationBeginEvent
  | PipelineRequestFailureEvent
  | PipelineInvocationFailureEvent

export type PipelineEvent = PipelineRequestEvent | PipelineInvocationEvent

export type PipelineInterceptor = (
  event: Readonly<PipelineEvent>,
  tools: { patch: typeof produce }
) => Promise<unknown>

export type PipelinePlugin = { intercept?: PipelineInterceptor }

export type PipelineOptions = {
  parentId?: string
  plugins?: PipelinePlugin[]
}

type InputOf<M> = M extends Middleware<infer I> ? I : never

type MergedInputs<Ms> = Ms extends (infer I)[] ? InputOf<I> : never

export type PipelineFactory = <Ms extends Middleware[]>(
  name: string,
  middlewares?: Middleware[]
) => Pipeline<MergedInputs<Ms>>

export type PipelineFactoryBuilder = (
  options?: PipelineOptions
) => PipelineFactory
