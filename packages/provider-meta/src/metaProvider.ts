import { ProviderClass, utils } from '@bot-whatsapp/bot'
import { BotContext, BotCtxMiddleware, SendOptions } from '@bot-whatsapp/bot/dist/types'
import axios from 'axios'
import FormData from 'form-data'
import { createReadStream } from 'fs'
import { writeFile } from 'fs/promises'
import mime from 'mime-types'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import Queue from 'queue-promise'

import { MetaWebHookServer } from './server'
import { Localization, Message, MetaProviderOptions, Reaction, SaveFileOptions, TextMessageBody } from './types'
import { downloadFile } from './utils'

const URL = `https://graph.facebook.com`

const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000

class MetaProvider extends ProviderClass {
    http: MetaWebHookServer | undefined
    jwtToken: string | undefined
    verifyToken: string | undefined
    numberId: string | undefined
    version: string = 'v16.0'
    queue: Queue

    constructor({ jwtToken, numberId, verifyToken, version, port = PORT }: MetaProviderOptions) {
        super()
        this.jwtToken = jwtToken
        this.numberId = numberId
        this.version = version
        this.verifyToken = verifyToken
        this.initHttpServer(port)

        const listEvents = this.busEvents()

        for (const { event, func } of listEvents) {
            this.http.on(event, func)
        }
        this.queue = new Queue({
            concurrent: 1,
            interval: 100,
            start: true,
        })
    }

    initHttpServer(port: number) {
        this.http = new MetaWebHookServer(this.jwtToken, this.numberId, this.version, this.verifyToken, port)
        const methods: BotCtxMiddleware = {
            sendMessage: this.sendMessage,
            provider: this.vendor,
        }
        this.http.start(methods, port)
    }

    /**
     * Mapeamos los eventos nativos a los que la clase Provider espera
     * para tener un standar de eventos
     * @returns
     */
    busEvents = () => [
        {
            event: 'auth_failure',
            func: (payload: any) => this.emit('error', payload),
        },
        {
            event: 'ready',
            func: () => this.emit('ready', true),
        },
        {
            event: 'message',
            func: (payload: any) => {
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

    /**
     * Sends a message with metadata to the API.
     *
     * @param {Object} body - The body of the message.
     * @return {void} A Promise that resolves when the message is sent.
     */
    sendMessageMeta(body: TextMessageBody): void {
        return this.queue.add(() => this.sendMessageToApi(body))
    }

    /**
     * Sends a message to the API.
     *
     * @param {Object} body - The body of the message.
     * @return {Object} The response data from the API.
     */
    async sendMessageToApi(body: TextMessageBody): Promise<any> {
        try {
            const response = await axios.post(`${URL}/${this.version}/${this.numberId}/messages`, body, {
                headers: {
                    Authorization: `Bearer ${this.jwtToken}`,
                },
            })
            return response.data
        } catch (error) {
            console.error(error.message)
            throw error
        }
    }

    sendtext = async (to: string, message: string) => {
        const body: TextMessageBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: {
                preview_url: false,
                body: message,
            },
        }
        return this.sendMessageMeta(body)
    }

    sendImage = async (to: string, mediaInput = null) => {
        if (!mediaInput) throw new Error(`MEDIA_INPUT_NULL_: ${mediaInput}`)

        const formData = new FormData()
        const mimeType = mime.lookup(mediaInput)
        formData.append('file', createReadStream(mediaInput), {
            contentType: mimeType,
        })
        formData.append('messaging_product', 'whatsapp')

        const {
            data: { id: mediaId },
        } = await axios.post(`${URL}/${this.version}/${this.numberId}/media`, formData, {
            headers: {
                Authorization: `Bearer ${this.jwtToken}`,
                ...formData.getHeaders(),
            },
        })

        const body: TextMessageBody = {
            messaging_product: 'whatsapp',
            to,
            type: 'image',
            image: {
                id: mediaId,
            },
        }
        return this.sendMessageMeta(body)
    }
    /**
     *
     * @param {*} number
     * @param {*} _
     * @param {*} pathVideo
     * @returns
     */
    sendVideo = async (to: string, pathVideo = null) => {
        if (!pathVideo) throw new Error(`MEDIA_INPUT_NULL_: ${pathVideo}`)

        const formData = new FormData()
        const mimeType = mime.lookup(pathVideo)
        formData.append('file', createReadStream(pathVideo), {
            contentType: mimeType,
        })
        formData.append('messaging_product', 'whatsapp')

        const {
            data: { id: mediaId },
        } = await axios.post(`${URL}/${this.version}/${this.numberId}/media`, formData, {
            headers: {
                Authorization: `Bearer ${this.jwtToken}`,
                ...formData.getHeaders(),
            },
        })

        const body = {
            messaging_product: 'whatsapp',
            to,
            type: 'video',
            video: {
                id: mediaId,
            },
        }
        return this.sendMessageMeta(body)
    }

    /**
     * @alpha
     * @param {string} number
     * @param {string} message
     * @example await sendMessage('+XXXXXXXXXXX', 'https://dominio.com/imagen.jpg' | 'img/imagen.jpg')
     */

    sendMedia = async (to: string, text = '', mediaInput: string) => {
        const fileDownloaded = await utils.generalDownload(mediaInput)
        const mimeType = mime.lookup(fileDownloaded)
        mediaInput = fileDownloaded
        if (mimeType.includes('image')) return this.sendImage(to, mediaInput)
        if (mimeType.includes('video')) return this.sendVideo(to, fileDownloaded)
        if (mimeType.includes('audio')) {
            const fileOpus = await utils.convertAudio(mediaInput)
            return this.sendAudio(to, fileOpus, text)
        }

        return this.sendFile(to, mediaInput)
    }

    /**
     * Enviar listas
     * @param {*} number
     * @param {*} text
     * @param {*} buttons
     * @returns
     */
    sendLists = async (to: string, list: any) => {
        const parseList = { ...list, ...{ type: 'list' } }
        const body: TextMessageBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: parseList,
        }
        return this.sendMessageMeta(body)
    }

    /**
     * Enviar listas alternativo
     * @param {*} number
     * @param {*} header
     * @param {*} text
     * @param {*} footer
     * @param {*} button
     * @param {*} list
     * @returns
     */
    sendList = async (to: string, header: string, text: string, footer: string, button: string, list = []) => {
        const parseList = list.map((list) => ({
            title: list.title,
            rows: list.rows.map((row) => ({
                id: row.id,
                title: row.title,
                description: row.description,
            })),
        }))

        const body = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: {
                type: 'list',
                header: {
                    type: 'text',
                    text: header,
                },
                body: {
                    text: text,
                },
                footer: {
                    text: footer,
                },
                action: {
                    button: button,
                    sections: parseList,
                },
            },
        }
        return this.sendMessageMeta(body)
    }

    /**
     * Enviar buttons
     * @param {*} number
     * @param {*} text
     * @param {*} buttons
     * @returns
     */
    sendButtons = async (to: string, text: string, buttons = []) => {
        const parseButtons = buttons.map((btn, i) => ({
            type: 'reply',
            reply: {
                id: `btn-${i}`,
                title: btn.body,
            },
        }))

        const body: TextMessageBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: {
                type: 'button',
                body: {
                    text: text,
                },
                action: {
                    buttons: parseButtons,
                },
            },
        }
        return this.sendMessageMeta(body)
    }

    /**
     * Enviar buttons only text
     * @param {*} number
     * @param {*} text
     * @param {*} buttons
     * @returns
     */
    sendButtonsText = async (to: string, text: string, buttons = []) => {
        const parseButtons = buttons.map((btn) => ({
            type: 'reply',
            reply: {
                id: btn.id,
                title: btn.title,
            },
        }))
        const body: TextMessageBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: {
                type: 'button',
                body: {
                    text: text,
                },
                action: {
                    buttons: parseButtons,
                },
            },
        }
        return this.sendMessageMeta(body)
    }

    /**
     * Enviar buttons with image
     * @param {*} number
     * @param {*} text
     * @param {*} buttons
     * @param {*} url
     * @returns
     */
    sendButtonsMedia = async (to: string, text: string, buttons = [], url: string) => {
        const parseButtons = buttons.map((btn) => ({
            type: 'reply',
            reply: {
                id: btn.id,
                title: btn.title,
            },
        }))
        const body: TextMessageBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: {
                type: 'button',
                header: {
                    type: 'image',
                    image: {
                        link: url,
                    },
                },
                body: {
                    text: text,
                },
                action: {
                    buttons: parseButtons,
                },
            },
        }
        return this.sendMessageMeta(body)
    }

    /**
     * Enviar plantillas
     * @param {*} number
     * @param {*} template
     * @param {*} languageCode
     * Usarse de acuerdo a cada plantilla en particular, esto solo es un mapeo de como funciona.
     * @returns
     */

    sendTemplate = async (number, template, languageCode) => {
        const body: any = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: number,
            type: 'template',
            template: {
                name: template,
                language: {
                    code: languageCode, // examples: es_Mex, en_Us
                },
                components: [
                    {
                        type: 'header',
                        parameters: [
                            {
                                type: 'image',
                                image: {
                                    link: 'https://i.imgur.com/3xUQq0U.png',
                                },
                            },
                        ],
                    },
                    {
                        type: 'body',
                        parameters: [
                            {
                                type: 'text', // currency, date_time, etc
                                text: 'text-string',
                            },
                            {
                                type: 'currency',
                                currency: {
                                    fallback_value: '$100.99',
                                    code: 'USD',
                                    amount_1000: 100990,
                                },
                            },
                        ],
                    },
                    {
                        type: 'button',
                        subtype: 'quick_reply',
                        index: 0,
                        parameters: [
                            {
                                type: 'payload',
                                payload: 'aGlzIHRoaXMgaXMgY29v',
                            },
                        ],
                    },
                ],
            },
        }
        return this.sendMessageMeta(body)
    }

    /**
     * Enviar Contactos
     * @param {*} number
     * @param {*} contact
     * @returns
     */

    sendContacts = async (to: string, contact = []) => {
        const parseContacts = contact.map((contact) => ({
            name: {
                formatted_name: contact.name,
                first_name: contact.first_name,
                last_name: contact.last_name,
                middle_name: contact.middle_name,
                suffix: contact.suffix,
                prefix: contact.prefix,
            },
            birthday: contact.birthday,
            phones: contact.phones.map((phone) => ({
                phone: phone.phone,
                wa_id: phone.wa_id,
                type: phone.type,
            })),
            emails: contact.emails.map((email) => ({
                email: email.email,
                type: email.type,
            })),
            org: {
                company: contact.company,
                department: contact.department,
                title: contact.title,
            },
            urls: contact.urls.map((url) => ({
                url: url.url,
                type: url.type,
            })),
            addresses: contact.addresses.map((address) => ({
                street: address.street,
                city: address.city,
                state: address.state,
                zip: address.zip,
                country: address.country,
                country_code: address.counry_code,
                type: address.type,
            })),
        }))

        const body = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'contacts',
            contacts: parseContacts,
        }
        return this.sendMessageMeta(body)
    }

    /**
     * Enviar catálogo
     * @param {*} number
     * @param {*} bodyText
     * @param {*} itemCatalogId
     * @param {*} footerText
     * @returns
     */

    sendCatalog = async (number, bodyText, itemCatalogId) => {
        const body = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: number,
            type: 'interactive',
            interactive: {
                type: 'catalog_message',
                body: {
                    text: bodyText,
                },
                action: {
                    name: 'catalog_message',
                    parameters: {
                        thumbnail_product_retailer_id: itemCatalogId,
                    },
                },
            },
        }
        return this.sendMessageMeta(body)
    }

    /**
     *
     * @param {*} userId
     * @param {*} message
     * @param {*} param2
     * @returns
     */
    sendMessage = async (number: string, message: string, options?: SendOptions): Promise<any> => {
        options = { ...options, ...options['options'] }
        if (options?.buttons?.length) return this.sendButtons(number, message, options.buttons)
        if (options?.media) return this.sendMedia(number, message, options.media)

        this.sendtext(number, message)
    }

    /**
     * Enviar reacción a un mensaje
     * @param {*} number
     * @param {*} react
     */
    sendReaction = async (number: string, react: Reaction) => {
        const body = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: number,
            type: 'reaction',
            reaction: {
                message_id: react.message_id,
                emoji: react.emoji,
            },
        }
        return this.sendMessageMeta(body)
    }

    /**
     * Enviar Ubicación
     * @param {*} longitude
     * @param {*} latitude
     * @param {*} name
     * @param {*} address
     * @returns
     */
    sendLocation = async (to: string, localization: Localization) => {
        const { long_number, lat_number, name, address } = localization
        const body = {
            messaging_product: 'whatsapp',
            to,
            type: 'location',
            location: {
                name,
                address,
                longitude: long_number,
                latitude: lat_number,
            },
        }
        return this.sendMessageMeta(body)
    }

    saveFile = async (ctx: Partial<Message & BotContext>, options: SaveFileOptions = {}): Promise<string> => {
        try {
            const { buffer, extension } = await downloadFile(ctx?.url, this.jwtToken)
            const fileName = `file-${Date.now()}.${extension}`
            const pathFile = join(options?.path ?? tmpdir(), fileName)
            await writeFile(pathFile, buffer)
            return pathFile
        } catch (err) {
            console.log(`[Error]:`, err.message)
            return 'ERROR'
        }
    }

    sendFile = async (to: string, mediaInput = null) => {
        if (!mediaInput) throw new Error(`MEDIA_INPUT_NULL_: ${mediaInput}`)

        const formData = new FormData()
        const mimeType = mime.lookup(mediaInput)
        formData.append('file', createReadStream(mediaInput), {
            contentType: mimeType,
        })
        formData.append('messaging_product', 'whatsapp')

        const nameOriginal = basename(mediaInput) || 'Doc'

        const {
            data: { id: mediaId },
        } = await axios.post(`${URL}/${this.version}/${this.numberId}/media`, formData, {
            headers: {
                Authorization: `Bearer ${this.jwtToken}`,
                ...formData.getHeaders(),
            },
        })

        const body = {
            messaging_product: 'whatsapp',
            to: to,
            type: 'document',
            document: {
                id: mediaId,
                filename: nameOriginal,
            },
        }
        return this.sendMessageMeta(body)
    }

    sendAudio(to: string, fileOpus: string, text: string) {
        console.log({ to, fileOpus, text })
    }
}

export { MetaProvider }
