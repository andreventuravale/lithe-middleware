import {
  AnonymousMiddleware,
  Middleware,
  makePipeline,
  passAlong
} from './main.js'
import test from 'ava'

test('linear', async (t) => {
  const pipeline = makePipeline([
    (next) => async (text) => await next(text + ' b'),
    (next) => async (text) => await next(text + 'a'),
    (next) => async (text) => await next(text + 'r')
  ])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('an empty pipeline returns the original output', async (t) => {
  const pipeline = makePipeline([])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo')
})

test('nested', async (t) => {
  const pipeline = makePipeline([
    (next) => async (input) => await next(input + 'a'),
    (next) => async (input) =>
      await next(
        await makePipeline([
          (next) => async (input) => await next(input + 'b'),
          (next) => async (input) => await next(input + 'c')
        ])()(input)
      )
  ])

  const request = pipeline()

  const reply = await request('')

  t.deepEqual(reply, 'abc')
})

test('named links', async (t) => {
  const pipeline = makePipeline([
    (next) => async (input) => await next(input + ' b'),
    ['adds a', (next) => async (output) => await next(output + 'a')],
    ['adds r', (next) => async (output) => await next(output + 'r')]
  ])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('places a middleware prior to', async (t) => {
  const pipeline = makePipeline([
    (next) => async (input) => await next(input + ' b'),
    ['adds r', (next) => async (input) => await next(input + 'r')]
  ])

  const request = pipeline([
    ['before', 'adds r', (next) => async (input) => await next(input + 'a')]
  ])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('adds a middleware subsequent to', async (t) => {
  const pipeline = makePipeline([
    (next) => async (input) => await next(input + ' b'),
    ['adds a', (next) => async (input) => await next(input + 'a')]
  ])

  const request = pipeline([
    ['after', 'adds a', (next) => async (input) => await next(input + 'r')]
  ])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('produces an error if the modification reference cannot be found', async (t) => {
  const pipeline = makePipeline([
    (next) => async (input) => await next(input + ' b'),
    ['adds r', (next) => async (input) => await next(input + 'r')]
  ])

  const request = pipeline([
    ['before', 'foo bar', (next) => async (input) => await next(input + 'a')]
  ])

  await t.throwsAsync(
    async () => {
      await request('foo')
    },
    { message: 'could not find middleware named: "foo bar"' }
  )
})

test('modifications do not affect the original input list', async (t) => {
  const list: Middleware[] = [
    (next) => async (input) => await next(input + ' b'),
    ['adds r', (next) => async (input) => await next(input + 'r')]
  ]

  const pipeline = makePipeline(list)

  t.truthy(list.length === 2)

  const request = pipeline([
    ['before', 'adds r', (next) => async (input) => await next(input + 'a')]
  ])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')

  t.true(list.length === 2)
})

test('normal pipelines do not affect the original input list', async (t) => {
  const list: AnonymousMiddleware[] = [
    (next) => async (input) => await next(input + ' b'),
    (next) => async (input) => await next(input + 'a'),
    (next) => async (input) => await next(input + 'r')
  ]

  const pipeline = makePipeline(list)

  t.truthy(list.length === 3)

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')

  t.truthy(list.length === 3)
})

test('modifications are processed in the same sequence as they are provided', async (t) => {
  const list: Middleware[] = [
    ['first', (next) => async (input) => await next(input + ' b')]
  ]

  const pipeline = makePipeline(list)

  const request = pipeline([
    ['after', 'first', (next) => async (input) => await next(input + 'a')],
    ['after', 'first', (next) => async (input) => await next(input + 'r')]
  ])

  const reply = await request('foo')

  t.deepEqual(reply, 'foo bar')
})

test('modifications are processed in the same sequence as they are provided ( extended case )', async (t) => {
  const list: Middleware[] = [
    ['1st', (next) => async (input) => await next(input + '1')],
    ['2nd', (next) => async (input) => await next(input + '2')],
    ['3rd', (next) => async (input) => await next(input + '3')],
    ['4th', (next) => async (input) => await next(input + '4')]
  ]

  const pipeline = makePipeline(list)

  const request = pipeline([
    ['after', '1st', (next) => async (input) => await next(input + 'a')],
    ['after', '4th', (next) => async (input) => await next(input + 'd')],
    ['before', '3rd', (next) => async (input) => await next(input + 'c')],
    ['after', '1st', (next) => async (input) => await next(input + 'b')]
  ])

  const reply = await request('')

  t.deepEqual(reply, '1ab2c34d')
})

test('substituting links', async (t) => {
  const pipeline = makePipeline([
    ['foo', (next) => async (input) => await next(input + 'foo')],
    ['bar', (next) => async (input) => await next(input + ' bar')]
  ])

  t.deepEqual(await pipeline()(''), 'foo bar')

  t.deepEqual(
    await pipeline([
      ['replace', 'foo', (next) => async (input) => await next(input + 'qux')],
      [
        'replace',
        'bar',
        (next) => async (input) => await next(input + ' waldo')
      ]
    ])(''),
    'qux waldo'
  )
})

test('bypassing middleware processing', async (t) => {
  const pipeline = makePipeline([
    ['1st', (next) => async (input) => await next(input + '1')],
    ['2nd', (next) => async (input) => await next(input + ' 2')],
    ['3rd', (next) => async (input) => await next(input + ' 3')]
  ])

  t.deepEqual(await pipeline()(''), '1 2 3')

  t.deepEqual(await pipeline([['skip', '2nd']])(''), '1 3')
})

test('the passAlong helper', async (t) => {
  const pipeline = makePipeline([passAlong((input) => input)])

  const request = pipeline()

  const reply = await request('foo')

  t.deepEqual(reply, 'foo')
})

test('appending links', async (t) => {
  const pipeline = makePipeline([
    ['1st', (next) => async (input) => await next(input + '1')],
    ['2nd', (next) => async (input) => await next(input + ' 2')],
    ['3rd', (next) => async (input) => await next(input + ' 3')]
  ])

  t.deepEqual(
    await pipeline([
      (next) => async (input) => await next(input + ' 4'),
      (next) => async (input) => await next(input + ' 5')
    ])(''),
    '1 2 3 4 5'
  )
})

test('does allow mutations', async (t) => {
  const pipeline = makePipeline([
    (next) => async (input: { foo: string }) => {
      input.foo = 'baz'

      return await next(input)
    }
  ])

  await t.throwsAsync(async () => await pipeline()({ foo: 'bar' }), {
    message: /Cannot assign to read only property 'foo'/
  })
})

test('does allow deep mutations', async (t) => {
  const pipeline = makePipeline([
    (next) => async (input: { foo: { bar: string } }) => {
      input.foo.bar = 'qux'

      return await next(input)
    }
  ])

  await t.throwsAsync(async () => await pipeline()({ foo: { bar: 'baz' } }), {
    message: /Cannot assign to read only property 'bar'/
  })
})

test('does allow deep mutations inside arrays', async (t) => {
  const pipeline = makePipeline([
    (next) => async (input: { foo: Array<number | { bar: string }> }) => {
      const entry = input.foo[1] as { bar: string }

      entry.bar = 'qux'

      return await next(input)
    }
  ])

  await t.throwsAsync(
    async () => await pipeline()({ foo: [0, { bar: 'baz' }] }),
    {
      message: /Cannot assign to read only property 'bar'/
    }
  )
})

test('I can specify a resulting type without breaking the type-checker', async (t) => {
  const pipeline = makePipeline([(next) => async (input) => await next(input)])

  const request = pipeline<{ foo: { bar: string } }>()

  const reply = await request({ foo: 'bar' })

  t.deepEqual(reply.foo, 'bar')
})
