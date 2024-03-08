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

export type PipelineModifications<Input = unknown> =
  | ['before' | 'after' | 'replace', name: string, Middleware<Input>]
  | ['skip', name: string]
  | Middleware<Input>

export type Pipeline<Input = unknown> = (
  modifications?: PipelineModifications[]
) => MiddlewareHandler<Input>

export type PipelineEventType = 'begin' | 'end'

export type PipelineBaseEvent<Type extends PipelineEventType> = {
  type: Type
  name: string | undefined
  input: unknown
}

export type PipelineBeginEvent = PipelineBaseEvent<'begin'>

export type PipelineEndEvent = PipelineBaseEvent<'end'> & {
  status: 'success' | 'failure'
  error?: Error
}

export type PipelineEvent = PipelineBeginEvent | PipelineEndEvent

export type PipelineEventHandler = (
  event: Readonly<PipelineEvent>
) => Promise<void>

export type PipelinePlugin = { event?: PipelineEventHandler }

export type PipelineOptions = {
  plugins?: PipelinePlugin[]
}

type InputOf<M> = M extends Middleware<infer I> ? I : never

type MergedInputs<Ms> = Ms extends (infer I)[] ? InputOf<I> : never

export type PipelineFactory = <Ms extends Middleware[]>(
  middlewares: Middleware[]
) => Pipeline<MergedInputs<Ms>>

export type PipelineFactoryBuilder = (
  options?: PipelineOptions
) => PipelineFactory