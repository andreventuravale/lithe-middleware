import builder, {
  type AnonymousMiddleware,
  type Middleware,
  type PipelineEventHandler
} from './main.js'
import test from 'ava'
import { explain, func, verify } from 'testdouble'

test('Happy path.', async (t) => {
  const b = (next) => async (text) => await next(text + ' b')

  const a = (next) => async (text) => await next(text + 'a')

  const r = (next) => async (text) => await next(text + 'r')

  const pipeline = builder()([b, a, r])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('Modifications on a initial empty middleware list.', async (t) => {
  const b = (next) => async (text) => await next(text + ' b')

  const a = (next) => async (text) => await next(text + 'a')

  const r = (next) => async (text) => await next(text + 'r')

  const pipeline = builder()([])

  const request = pipeline([b, a, r])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

/**
 * This behavior is intentional. Errors do not propagate back through the middleware that has already been executed:
 *
 * After a middleware has been executed, it is permanently dismissed and not revisited.
 * There is no possibility of disguising an error with another error resulting from a previous middleware being unexpectedly affected.
 */
test('Propagates errors directly to the pipeline caller without rippling back through the preceding middlewares.', async (t) => {
  const bCatch = func()
  const aCatch = func()

  const b = (next) => async (text) => {
    try {
      return await next(text + ' b')
    } catch (error) {
      bCatch(error)

      throw error
    }
  }

  const a = (next) => async (text) => {
    try {
      return await next(text + 'a')
    } catch (error) {
      aCatch(error)

      throw error
    }
  }

  const r = () => async () => {
    throw new Error('rrrrrrrrrrrr')
  }

  const pipeline = builder()([b, a, r])

  const request = pipeline()

  await t.throwsAsync(
    async () => {
      await request('foo')
    },
    { message: 'rrrrrrrrrrrr' }
  )

  verify(bCatch(), { times: 0, ignoreExtraArgs: true })
  verify(aCatch(), { times: 0, ignoreExtraArgs: true })
})

test('An empty pipeline outputs the original input unchanged.', async (t) => {
  const pipeline = builder()([])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo')
})

test('Nested pipelines.', async (t) => {
  const a = (next) => async (input) => await next(input + 'a')

  const b = (next) => async (input) => await next(input + 'b')

  const c = (next) => async (input) => await next(input + 'c')

  const bc = (next) => async (input) =>
    await next(await builder()([b, c])()(input))

  const pipeline = builder()([a, bc])

  const request = pipeline()

  const reply = await request('')

  t.deepEqual(reply, 'abc')
})

test('Named middlewares (tuple mode).', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (output) => await next(output + 'a')

  const r = (next) => async (output) => await next(output + 'r')

  const pipeline = builder()([b, ['adds a', a], ['adds r', r]])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('Positions a middleware before another.', async (t) => {
  const hello = (next) => async (input) => await next('hello ' + input)

  const b = (next) => async (input) => await next(input + ' b')

  function a(next) {
    return async (input) => await next(input + 'a')
  }

  const r = (next) => async (input) => await next(input + 'r')

  const pipeline = builder()([b, ['r', r]])

  const request = pipeline([
    ['before', 'b', hello],
    ['before', 'r', a]
  ])

  const reply = await request('foo')

  t.deepEqual(reply, 'hello foo bar')
})

test('Inserts a middleware adjacent to another.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (input) => await next(input + 'a')

  function r(next) {
    return async (input) => await next(input + 'r')
  }

  const baz = (next) => async (input) => await next(input + ' baz')

  const pipeline = builder()([b, r])

  const request = pipeline([
    ['after', 'b', a],
    ['after', 'r', baz]
  ])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar baz')
})

test('Replacing middlewares.', async (t) => {
  const foo = (next) => async (input) => await next(input + 'foo')

  function bar(next) {
    return async (input) => await next(input + ' bar')
  }

  const pipeline = builder()([
    ['foo', foo],
    ['bar', bar]
  ])

  t.deepEqual(await pipeline()(''), 'foo bar')

  const qux = (next) => async (input) => await next(input + 'qux')

  const waldo = (next) => async (input) => await next(input + ' waldo')

  t.deepEqual(
    await pipeline([
      ['replace', 'foo', qux],
      ['replace', 'bar', waldo]
    ])(''),
    'qux waldo'
  )
})

test('Skipping middlewares.', async (t) => {
  function first(next) {
    return async (input) => await next(input + '1')
  }

  const second = (next) => async (input) => await next(input + ' 2')

  const third = (next) => async (input) => await next(input + ' 3')

  const pipeline = builder()([
    ['first', first],
    ['second', second],
    ['third', third]
  ])

  t.deepEqual(await pipeline()(''), '1 2 3')

  t.deepEqual(
    await pipeline([
      ['skip', 'first'],
      ['skip', 'second']
    ])(''),
    ' 3'
  )
})

test('Appending middlewares.', async (t) => {
  const first = (next) => async (input) => await next(input + '1')

  const second = (next) => async (input) => await next(input + ' 2')

  const third = (next) => async (input) => await next(input + ' 3')

  const pipeline = builder()([first, second, third])

  const d = (next) => async (input) => await next(input + ' 4')

  const e = (next) => async (input) => await next(input + ' 5')

  t.deepEqual(await pipeline([d, e])(''), '1 2 3 4 5')
})

test('Generates an error if the referenced modification cannot be located.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const r = (next) => async (input) => await next(input + 'r')

  const pipeline = builder()([b, r])

  const a = (next) => async (input) => await next(input + 'a')

  const request = pipeline([['before', 'foo bar', a]])

  await t.throwsAsync(
    async () => {
      await request('foo')
    },
    { message: 'could not find middleware named: "foo bar"' }
  )
})

test('Modifications made at the request level, also known as request-level middlewares, do not influence the middleware list at the pipeline level.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const r = (next) => async (input) => await next(input + 'r')

  const list: Middleware[] = [b, ['adds r', r]]

  const pipeline = builder()(list)

  t.truthy(list.length === 2)

  const a = (next) => async (input) => await next(input + 'a')

  const request = pipeline([['before', 'adds r', a]])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')

  t.true(list.length === 2)
})

test('Not providing any middlewares at the request level does not impact the list of middlewares at the pipeline level.', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (input) => await next(input + 'a')

  const r = (next) => async (input) => await next(input + 'r')

  const list: AnonymousMiddleware[] = [b, a, r]

  const factory = builder()(list)

  t.truthy(list.length === 3)

  const request = factory()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')

  t.truthy(list.length === 3)
})

test('Request-level middlewares, also known as modifications, are executed within the scope of the pipeline-level process.', async (t) => {
  const first = (next) => async (input) => await next(input + ' b')

  const list: Middleware[] = [['first', first]]

  const pipeline = builder()(list)

  const a = (next) => async (input) => await next(input + 'a')

  const r = (next) => async (input) => await next(input + 'r')

  const request = pipeline([
    ['after', 'first', a],
    ['after', 'first', r]
  ])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('Request-level middlewares, also known as modifications, are incorporated and executed as part of the broader pipeline-level operations.', async (t) => {
  const first = (next) => async (input) => await next(input + '1')

  const second = (next) => async (input) => await next(input + '2')

  const third = (next) => async (input) => await next(input + '3')

  const forth = (next) => async (input) => await next(input + '4')

  const list: Middleware[] = [
    ['first', first],
    ['second', second],
    ['third', third],
    ['4th', forth]
  ]

  const pipeline = builder()(list)

  const a = (next) => async (input) => await next(input + 'a')

  const d = (next) => async (input) => await next(input + 'd')

  const c = (next) => async (input) => await next(input + 'c')

  const b = (next) => async (input) => await next(input + 'b')

  const request = pipeline([
    ['after', 'first', a],
    ['after', '4th', d],
    ['before', 'third', c],
    ['after', 'first', b]
  ])

  const reply = await request('')

  t.deepEqual(reply, '1ab2c34d')
})

test('Forbids changes to the input.', async (t) => {
  type Foo = { foo: string }

  const foo = (next) => async (input: Foo) => {
    input.foo = 'baz'

    return await next(input)
  }

  const factory = builder()

  const pipeline = factory([foo])

  const request = pipeline()

  await t.throwsAsync(async () => await request({ foo: 'bar' }), {
    message: /Cannot assign to read only property 'foo'/
  })
})

test('Forbids changes to the input (deep).', async (t) => {
  const foo = (next) => async (input: { foo: { bar: string } }) => {
    input.foo.bar = 'qux'

    return await next(input)
  }

  const request = builder()([foo])()

  await t.throwsAsync(async () => await request({ foo: { bar: 'baz' } }), {
    message: /Cannot assign to read only property 'bar'/
  })
})

test('Forbids changes to the input (deep in arrays).', async (t) => {
  const fooBar = (next) => async (input: { foo: Array<{ bar: string }> }) => {
    const entry = input.foo[1]

    entry.bar = 'qux'

    return await next(input)
  }

  const request = builder()([fooBar])()

  await t.throwsAsync(async () => await request({ foo: [0, { bar: 'baz' }] }), {
    message: /Cannot assign to read only property 'bar'/
  })
})

test('In a typeless pipeline, you can specify the output type at the request level using generics, without encountering any issues from the type checker.', async (t) => {
  const typelessFactory = builder()

  const typelessMiddleware = (next) => async (input) => await next(input)

  const typelessPipeline = typelessFactory([typelessMiddleware])

  const typelessRequest = typelessPipeline()

  const reply = await typelessRequest<{ foo: { bar: string } }>({ foo: 'bar' })

  t.deepEqual(reply.foo, 'bar')
})

test('(Plugins) Events.', async (t) => {
  const event = func<PipelineEventHandler>()

  const factory = builder({
    plugins: [
      {
        event
      }
    ]
  })

  const first = (next) => async (input) => await next(input + '1')

  function second(next) {
    return async (input) => await next(input + ' 2')
  }

  const third = (next) => async (input) => await next(input + ' 3')

  const pipeline = factory([['first', first], second, ['third', third]])

  const request = pipeline()

  await request('')

  verify(event({ type: 'begin', input: '1 2', name: 'third' }))
  verify(event({ type: 'begin', input: '1', name: 'second' }))
  verify(event({ type: 'begin', input: '', name: 'first' }))

  t.deepEqual(
    explain(event).calls.map(({ args }) => args),
    [
      [{ type: 'begin', input: '', name: 'first' }],
      [
        {
          type: 'end',
          input: '',
          name: 'first',
          status: 'success'
        }
      ],
      [{ type: 'begin', input: '1', name: 'second' }],
      [
        {
          type: 'end',
          input: '1',
          name: 'second',
          status: 'success'
        }
      ],
      [{ type: 'begin', input: '1 2', name: 'third' }],
      [
        {
          type: 'end',
          input: '1 2',
          name: 'third',
          status: 'success'
        }
      ]
    ]
  )
})

test('(Plugins) Events with failures.', async (t) => {
  const event = func<PipelineEventHandler>()

  const first = (next) => async (input) => await next(input + '1')

  const second = (next) => async (input) => await next(input + ' 2')

  function third() {
    return async () => {
      throw new Error('error on third')
    }
  }

  const pipeline = builder({
    plugins: [
      {
        event
      }
    ]
  })([['first', first], ['second', second], third])

  const request = pipeline()

  await t.throwsAsync(
    async () => {
      await request('')
    },
    { message: 'error on third' }
  )

  verify(event({ type: 'begin', input: '', name: 'first' }))
  verify(event({ type: 'begin', input: '1', name: 'second' }))
  verify(event({ type: 'begin', input: '1 2', name: 'third' }))

  verify(
    event({
      type: 'end',
      input: '1 2',
      name: 'third',
      status: 'failure',
      error: new Error('error on third')
    })
  )
})
