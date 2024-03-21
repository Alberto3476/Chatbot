import { ProviderClass, utils } from '@builderbot/bot'
import { Vendor } from '@builderbot/bot/dist/provider/providerClass'
import {
    BotContext,
    BotCtxMiddleware,
    BotCtxMiddlewareOptions,
    GlobalVendorArgs,
    SendOptions,
} from '@builderbot/bot/dist/types'
import { tmpdir } from 'os'
import { join } from 'path'
import twilio from 'twilio'

import { TwilioWebHookServer } from './server'
import { TwilioProviderMethods } from './twilioInterface'
import { ITwilioProviderOptions, TwilioRequestBody } from './types'
import { parseNumberFrom } from './utils'

class TwilioProvider extends ProviderClass implements TwilioProviderMethods {
    public http: TwilioWebHookServer
    public vendor: Vendor<twilio.Twilio>

    globalVendorArgs: ITwilioProviderOptions & Partial<GlobalVendorArgs> = {
        accountSid: undefined,
        authToken: undefined,
        vendorNumber: undefined,
    }

    constructor(args: ITwilioProviderOptions & Partial<GlobalVendorArgs>) {
        super()
        this.http = new TwilioWebHookServer(args?.port)
        this.globalVendorArgs = { ...this.globalVendorArgs, ...args }
        this.vendor = twilio(this.globalVendorArgs.accountSid, this.globalVendorArgs.authToken)
    }

    busEvents = () => [
        {
            event: 'auth_failure',
            func: (payload: any) => this.emit('auth_failure', payload),
        },
        {
            event: 'ready',
            func: () => this.emit('ready', true),
        },
        {
            event: 'message',
            func: (payload: BotContext) => {
                this.emit('message', payload)
            },
        },
        {
            event: 'host',
            func: (payload: any) => {
                this.emit('host', payload)
            },
        },
    ]

    sendMedia = async (number: string, message = '', mediaInput: string) => {
        const entryPointUrl = this.globalVendorArgs?.publicUrl ?? `http://localhost:${this.http.port}`
        if (!mediaInput) throw new Error(`Media cannot be null`)
        const encryptPath = utils.encryptData(encodeURIComponent(mediaInput))
        const urlEncode = `${entryPointUrl}/tmp?path=${encryptPath}`
        const regexUrl = /^(?!https?:\/\/)[^\s]+$/
        const instructions = [
            `You are trying to send a file that is local.`,
            `For this to work with Twilio, the file needs to be in a public URL.`,
            `More information here https://builderbot.vercel.app/en/twilio/uses-cases`,
            `This is the URL that will be sent to Twilio (must be public)`,
            ``,
            `${urlEncode}`,
        ]

        if (
            mediaInput.includes('localhost') ||
            mediaInput.includes('127.0.0.1') ||
            mediaInput.includes('0.0.0.0') ||
            regexUrl.test(mediaInput)
        ) {
            mediaInput = urlEncode

            this.emit('notice', {
                title: '🟠  WARNING 🟠',
                instructions,
            })
        }

        return this.vendor.messages.create({
            mediaUrl: [`${mediaInput}`],
            body: message,
            from: parseNumberFrom(this.globalVendorArgs.vendorNumber),
            to: parseNumberFrom(number),
        })
    }

    async sendButtons(): Promise<void> {
        this.emit('notice', {
            title: '📃 INFO 📃',
            instructions: [
                `Twilio presents a different way to implement buttons`,
                `To understand more about how it works, I recommend you check the following URLs`,
                `https://builderbot.vercel.app/en/providers/twilio/uses-cases`,
            ],
        })
    }

    listenOnEvents = () => {
        const listEvents = this.busEvents()
        for (const { event, func } of listEvents) {
            this.http.on(event, func)
        }
    }

    /**
     *
     * @param port
     * @param opts
     * @returns
     */
    initHttpServer = (port: number, opts: Pick<BotCtxMiddlewareOptions, 'blacklist'>) => {
        const methods: BotCtxMiddleware<TwilioProvider> = {
            sendMessage: this.sendMessage,
            provider: this,
            blacklist: opts.blacklist,
            dispatch: (customEvent, payload) => {
                this.emit('message', {
                    ...payload,
                    body: utils.setEvent(customEvent),
                    name: payload.name,
                    from: utils.removePlus(payload.from),
                })
            },
        }

        this.http.start(methods, port, { botName: this.globalVendorArgs.name }, (routes) => {
            this.emit('notice', {
                title: '🛜  HTTP Server ON ',
                instructions: routes,
            })

            this.emit('notice', {
                title: '⚡⚡ SETUP TWILIO ⚡⚡',
                instructions: [
                    `Add "When a message comes in"`,
                    `http://localhost:${port}/webhook`,
                    `More info https://builderbot.vercel.app/en/providers/twilio`,
                ],
            })

            const host = {
                phone: this.globalVendorArgs.vendorNumber,
            }
            this.emit('host', host)
        })

        this.listenOnEvents()
        return
    }

    sendMessage = async (number: string, message: string, options?: SendOptions): Promise<any> => {
        options = { ...options, ...options['options'] }
        if (options?.buttons?.length) await this.sendButtons()
        if (options?.media) return this.sendMedia(number, message, options.media)
        const response = this.vendor.messages.create({
            body: message,
            from: parseNumberFrom(this.globalVendorArgs.vendorNumber),
            to: parseNumberFrom(number),
        })
        return response
    }

    saveFile = async (ctx: Partial<TwilioRequestBody & BotContext>, options?: { path: string }): Promise<string> => {
        try {
            const pathFile = join(options?.path ?? tmpdir())
            const localPath = await utils.generalDownload(`${ctx?.MediaUrl0}`, pathFile)
            return localPath
        } catch (err) {
            console.log(`[Error]:`, err)
            return 'ERROR'
        }
    }
}

export { TwilioProvider }
