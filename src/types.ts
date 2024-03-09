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

export type Pipeline<Input = unknown> = (
  modifications?: PipelineModification[]
) => MiddlewareHandler<Input>

export type PipelineEventType = 'begin' | 'end'

export type PipelineBaseEvent<Type extends PipelineEventType> = {
  type: Type
  name: string | undefined
  input: unknown
}

export type PipelineBeginEvent = PipelineBaseEvent<'begin'>

export type PipelineSuccessEvent = PipelineBaseEvent<'end'> & {
  status: 'success'
  output: unknown
}

export type PipelineFailureEvent = PipelineBaseEvent<'end'> & {
  status: 'failure'
  error: Error
}

export type PipelineEndEvent = PipelineSuccessEvent | PipelineFailureEvent

export type PipelineEvent = PipelineBeginEvent | PipelineEndEvent

export type PipelineEventListener = (
  event: Readonly<PipelineEvent>,
  tools: { patch: typeof produce }
) => Promise<unknown>

export type PipelinePlugin = { listen?: PipelineEventListener }

export type PipelineOptions = {
  plugins?: PipelinePlugin[]
}

type InputOf<M> = M extends Middleware<infer I> ? I : never

type MergedInputs<Ms> = Ms extends (infer I)[] ? InputOf<I> : never

export type PipelineFactory = <Ms extends Middleware[]>(
  middlewares?: Middleware[]
) => Pipeline<MergedInputs<Ms>>

export type PipelineFactoryBuilder = (
  options?: PipelineOptions
) => PipelineFactory
