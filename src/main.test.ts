import builder, {
  type AnonymousMiddleware,
  type Middleware,
  type PipelineEventHandler
} from './main.js'
import test from 'ava'
import { explain, func, verify } from 'testdouble'

test('happy path', async (t) => {
  const b = (next) => async (text) => await next(text + ' b')

  const a = (next) => async (text) => await next(text + 'a')

  const r = (next) => async (text) => await next(text + 'r')

  const pipeline = builder()([b, a, r])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('an empty pipeline returns the original input as is', async (t) => {
  const pipeline = builder()([])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo')
})

test('nested', async (t) => {
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

test('named middlewares', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (output) => await next(output + 'a')

  const r = (next) => async (output) => await next(output + 'r')

  const pipeline = builder()([b, ['adds a', a], ['adds r', r]])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('places a middleware prior to', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const r = (next) => async (input) => await next(input + 'r')

  const pipeline = builder()([b, ['adds r', r]])

  const a = (next) => async (input) => await next(input + 'a')

  const request = pipeline([['before', 'adds r', a]])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('adds a middleware subsequent to', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (input) => await next(input + 'a')

  const pipeline = builder()([b, ['adds a', a]])

  const r = (next) => async (input) => await next(input + 'r')

  const request = pipeline([['after', 'adds a', r]])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('produces an error if the modification reference cannot be found', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const r = (next) => async (input) => await next(input + 'r')

  const pipeline = builder()([b, ['adds r', r]])

  const a = (next) => async (input) => await next(input + 'a')

  const request = pipeline([['before', 'foo bar', a]])

  await t.throwsAsync(
    async () => {
      await request('foo')
    },
    { message: 'could not find middleware named: "foo bar"' }
  )
})

test('modifications do not affect the original input list', async (t) => {
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

test('unmodified pipelines do not affect the original input list', async (t) => {
  const b = (next) => async (input) => await next(input + ' b')

  const a = (next) => async (input) => await next(input + 'a')

  const r = (next) => async (input) => await next(input + 'r')

  const list: AnonymousMiddleware[] = [b, a, r]

  const pipeline = builder()(list)

  t.truthy(list.length === 3)

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')

  t.truthy(list.length === 3)
})

test('modifications are processed in the same sequence as they are provided', async (t) => {
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

test('modifications are processed in the same sequence as they are provided ( extended case )', async (t) => {
  const first = (next) => async (input) => await next(input + '1')

  const second = (next) => async (input) => await next(input + '2')

  const third = (next) => async (input) => await next(input + '3')

  const forth = (next) => async (input) => await next(input + '4')

  const list: Middleware[] = [
    ['1st', first],
    ['2nd', second],
    ['3rd', third],
    ['4th', forth]
  ]

  const pipeline = builder()(list)

  const a = (next) => async (input) => await next(input + 'a')

  const d = (next) => async (input) => await next(input + 'd')

  const c = (next) => async (input) => await next(input + 'c')

  const b = (next) => async (input) => await next(input + 'b')

  const request = pipeline([
    ['after', '1st', a],
    ['after', '4th', d],
    ['before', '3rd', c],
    ['after', '1st', b]
  ])

  const reply = await request('')

  t.deepEqual(reply, '1ab2c34d')
})

test('substituting middlewares', async (t) => {
  const foo = (next) => async (input) => await next(input + 'foo')

  const bar = (next) => async (input) => await next(input + ' bar')

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

test('bypassing middleware processing', async (t) => {
  const first = (next) => async (input) => await next(input + '1')

  const second = (next) => async (input) => await next(input + ' 2')

  const third = (next) => async (input) => await next(input + ' 3')

  const pipeline = builder()([
    ['1st', first],
    ['2nd', second],
    ['3rd', third]
  ])

  t.deepEqual(await pipeline()(''), '1 2 3')

  t.deepEqual(await pipeline([['skip', '2nd']])(''), '1 3')
})

test('appending middlewares', async (t) => {
  const first = (next) => async (input) => await next(input + '1')

  const second = (next) => async (input) => await next(input + ' 2')

  const third = (next) => async (input) => await next(input + ' 3')

  const pipeline = builder()([
    ['1st', first],
    ['2nd', second],
    ['3rd', third]
  ])

  const d = (next) => async (input) => await next(input + ' 4')

  const e = (next) => async (input) => await next(input + ' 5')

  t.deepEqual(await pipeline([d, e])(''), '1 2 3 4 5')
})

test('does not allow mutations', async (t) => {
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

test('does not allow deep mutations', async (t) => {
  const foo = (next) => async (input: { foo: { bar: string } }) => {
    input.foo.bar = 'qux'

    return await next(input)
  }

  const request = builder()([foo])()

  await t.throwsAsync(async () => await request({ foo: { bar: 'baz' } }), {
    message: /Cannot assign to read only property 'bar'/
  })
})

test('does not allow deep mutations inside arrays', async (t) => {
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

test('given a typeless pipeline, I can type the output at the request-level, using generics, without any type-checker complains', async (t) => {
  const typelessFactory = builder()

  const typelessMiddleware = (next) => async (input) => await next(input)

  const typelessPipeline = typelessFactory([typelessMiddleware])

  const typelessRequest = typelessPipeline()

  const reply = await typelessRequest<{ foo: { bar: string } }>({ foo: 'bar' })

  t.deepEqual(reply.foo, 'bar')
})

test('plugins - events', async (t) => {
  const event = func<PipelineEventHandler>()

  const factory = builder({
    plugins: [
      {
        event
      }
    ]
  })

  const first = (next) => async (input) => await next(input + '1')

  const second = (next) => async (input) => await next(input + ' 2')

  const third = (next) => async (input) => await next(input + ' 3')

  const pipeline = factory([
    ['1st', first],
    ['2nd', second],
    ['3rd', third]
  ])

  const request = pipeline()

  await request('')

  verify(event({ type: 'begin', input: '1 2', name: '3rd' }))
  verify(event({ type: 'begin', input: '1', name: '2nd' }))
  verify(event({ type: 'begin', input: '', name: '1st' }))

  t.deepEqual(
    explain(event).calls.map(({ args }) => args),
    [
      [{ type: 'begin', input: '', name: '1st' }],
      [{ type: 'begin', input: '1', name: '2nd' }],
      [{ type: 'begin', input: '1 2', name: '3rd' }],
      [
        {
          type: 'end',
          input: '1 2',
          name: '3rd',
          status: 'success',
          error: undefined
        }
      ],
      [
        {
          type: 'end',
          input: '1',
          name: '2nd',
          status: 'success',
          error: undefined
        }
      ],
      [
        {
          type: 'end',
          input: '',
          name: '1st',
          status: 'success',
          error: undefined
        }
      ]
    ]
  )
})

test('plugins - events with failures', async (t) => {
  const event = func<PipelineEventHandler>()

  const first = (next) => async (input) => await next(input + '1')

  const second = (next) => async (input) => await next(input + ' 2')

  const third = () => async () => {
    throw new Error('error on 3rd')
  }

  const pipeline = builder({
    plugins: [
      {
        event
      }
    ]
  })([
    ['1st', first],
    ['2nd', second],
    ['3rd', third]
  ])

  const request = pipeline()

  await t.throwsAsync(
    async () => {
      await request('')
    },
    { message: 'error on 3rd' }
  )

  verify(event({ type: 'begin', input: '', name: '1st' }))
  verify(event({ type: 'begin', input: '1', name: '2nd' }))
  verify(event({ type: 'begin', input: '1 2', name: '3rd' }))

  verify(
    event({
      type: 'end',
      input: '1 2',
      name: '3rd',
      status: 'failure',
      error: new Error('error on 3rd')
    })
  )

  verify(
    event({
      type: 'end',
      input: '1',
      name: '2nd',
      status: 'failure',
      error: new Error('error on 3rd')
    })
  )

  verify(
    event({
      type: 'end',
      input: '',
      name: '1st',
      status: 'failure',
      error: new Error('error on 3rd')
    })
  )
})
