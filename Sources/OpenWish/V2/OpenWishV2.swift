import Foundation

public enum OpenWishAPIVersion {
    /// Try V2 first and transparently fall back to the live WishKit-compatible API.
    case automatic
    case v1
    case v2
}

public enum OpenWishIssueKind: String, Codable, CaseIterable, Identifiable {
    case bug
    case cardData

    public var id: String { rawValue }
}

public enum OpenWishValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: OpenWishValue])
    case array([OpenWishValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: OpenWishValue].self) { self = .object(value) }
        else { self = .array(try container.decode([OpenWishValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

public struct OpenWishCard: Codable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let setName: String?
    public let number: String?
    public let imageUrl: URL?
    public let metadata: [String: OpenWishValue]

    public init(
        id: String,
        name: String,
        setName: String? = nil,
        number: String? = nil,
        imageUrl: URL? = nil,
        metadata: [String: OpenWishValue] = [:]
    ) {
        self.id = id
        self.name = name
        self.setName = setName
        self.number = number
        self.imageUrl = imageUrl
        self.metadata = metadata
    }
}

public typealias OpenWishIssueContextProvider = () -> [String: OpenWishValue]
public typealias OpenWishCardSearchProvider = (String) async -> [OpenWishCard]
